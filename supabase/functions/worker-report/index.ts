// Endpoint do WORKER para reportar progresso/notas baixadas.
// Auth: X-Worker-Secret + worker_token do job.
// Body: { job_id, worker_token, action: 'add_invoice' | 'finish' | 'fail',
//         invoice?: {...}, error_message?: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { classifyInvoice, matchesInvoiceType } from "../_shared/invoice-type.ts";
import { readNfseEvent } from "../_shared/nfse-event.ts";
import { XMLParser } from "npm:fast-xml-parser@5.2.5";

// Texto puro (sem conversão numérica): chaves de 50 dígitos perdem precisão como número.
const eventParser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, removeNSPrefix: true });

async function markCancelled(admin: any, job: any, chave: string) {
  const { data: companyJobs, error } = await admin.from("download_jobs").select("id")
    .eq("owner_id", job.owner_id).eq("company_id", job.company_id);
  if (error) throw error;
  const ids = (companyJobs ?? []).map((row: { id: string }) => row.id);
  if (!ids.length) return;
  const { error: updateError } = await admin.from("invoices").update({ cancelada: true })
    .eq("owner_id", job.owner_id).eq("chave_acesso", chave).in("job_id", ids);
  if (updateError) throw updateError;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-worker-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const workerSecret = Deno.env.get("WORKER_SHARED_SECRET");
  const provided = req.headers.get("x-worker-secret");
  if (!workerSecret || provided !== workerSecret) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { job_id, worker_token, action } = body;
    if (!job_id || !worker_token || !action) {
      return new Response(JSON.stringify({ error: "Missing fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: job, error: jErr } = await admin
      .from("download_jobs").select("*").eq("id", job_id).single();
    if (jErr || !job) throw new Error("Job not found");
    if (job.worker_token !== worker_token) {
      return new Response(JSON.stringify({ error: "Invalid worker_token" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "add_invoice") {
      const inv = body.invoice ?? {};
      // Proteção no servidor: mesmo que o worker da VPS esteja desatualizado,
      // eventos (cancelamento etc.) nunca viram nota nem entram na contagem.
      if (inv.xml_base64) {
        let event = { isEvent: false, cancelledKey: null as string | null };
        try {
          const xmlText = new TextDecoder().decode(Uint8Array.from(atob(inv.xml_base64), (c) => c.charCodeAt(0)));
          event = readNfseEvent(eventParser.parse(xmlText));
        } catch (_) { /* XML ilegível: segue como nota */ }
        if (event.isEvent) {
          if (event.cancelledKey) await markCancelled(admin, job, event.cancelledKey);
          return new Response(JSON.stringify({ success: true, skipped: true, event: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      const { data: company } = await admin.from("companies").select("cnpj").eq("id", job.company_id).single();
      const tipo = classifyInvoice(inv.prestador_cnpj, inv.tomador_documento, company?.cnpj ?? "");
      if (!matchesInvoiceType(job.invoice_type ?? "ambas", tipo)) {
        return new Response(JSON.stringify({ success: true, skipped: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userFolder = `${job.owner_id}/${job.id}`;

      let xmlPath: string | null = null;
      let pdfPath: string | null = null;

      if (inv.xml_base64) {
        const xmlBytes = Uint8Array.from(atob(inv.xml_base64), (c) => c.charCodeAt(0));
        const path = `${userFolder}/${inv.chave_acesso || crypto.randomUUID()}.xml`;
        const { error } = await admin.storage.from("invoices").upload(path, xmlBytes, {
          contentType: "application/xml", upsert: true,
        });
        if (error) throw new Error("XML upload failed: " + error.message);
        xmlPath = path;
      }

      if (inv.pdf_base64) {
        const pdfBytes = Uint8Array.from(atob(inv.pdf_base64), (c) => c.charCodeAt(0));
        const path = `${userFolder}/${inv.chave_acesso || crypto.randomUUID()}.pdf`;
        const { error } = await admin.storage.from("invoices").upload(path, pdfBytes, {
          contentType: "application/pdf", upsert: true,
        });
        if (error) throw new Error("PDF upload failed: " + error.message);
        pdfPath = path;
      }

      const row = {
        tipo,
        chave_acesso: inv.chave_acesso ?? null,
        numero: inv.numero ?? null,
        serie: inv.serie ?? null,
        data_emissao: inv.data_emissao ?? null,
        prestador_cnpj: inv.prestador_cnpj ?? null,
        prestador_razao: inv.prestador_razao ?? null,
        tomador_nome: inv.tomador_nome ?? null,
        tomador_documento: inv.tomador_documento ?? null,
        valor_servicos: inv.valor_servicos ?? null,
        valor_total: inv.valor_total ?? inv.valor_servicos ?? null,
        xml_path: xmlPath,
        pdf_path: pdfPath,
      };

      // Mesma nota já baixada antes para esta empresa: atualiza em vez de duplicar.
      // Nunca volta uma nota cancelada para ativa.
      let existing: { id: string; cancelada: boolean | null }[] = [];
      if (inv.chave_acesso) {
        const { data: companyJobs } = await admin.from("download_jobs").select("id")
          .eq("owner_id", job.owner_id).eq("company_id", job.company_id);
        const ids = (companyJobs ?? []).map((r) => r.id);
        if (ids.length) {
          const { data } = await admin.from("invoices").select("id, cancelada")
            .eq("owner_id", job.owner_id).eq("chave_acesso", inv.chave_acesso).in("job_id", ids);
          existing = data ?? [];
        }
      }
      if (existing.length) {
        const wasCancelled = existing.some((e) => e.cancelada === true);
        const cancelada = wasCancelled || inv.cancelada === true ? true
          : typeof inv.cancelada === "boolean" ? inv.cancelada : existing[0].cancelada;
        const { error: updErr } = await admin.from("invoices").update({ ...row, cancelada })
          .in("id", existing.map((e) => e.id));
        if (updErr) throw updErr;
        await admin.from("download_jobs")
          .update({ downloaded_invoices: (job.downloaded_invoices ?? 0) + 1 })
          .eq("id", job.id);
        return new Response(JSON.stringify({ success: true, updated: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: insErr } = await admin.from("invoices").insert({
        tipo,
        cancelada: typeof inv.cancelada === "boolean" ? inv.cancelada : null,
        job_id: job.id,
        owner_id: job.owner_id,
        chave_acesso: inv.chave_acesso ?? null,
        numero: inv.numero ?? null,
        serie: inv.serie ?? null,
        data_emissao: inv.data_emissao ?? null,
        prestador_cnpj: inv.prestador_cnpj ?? null,
        prestador_razao: inv.prestador_razao ?? null,
        tomador_nome: inv.tomador_nome ?? null,
        tomador_documento: inv.tomador_documento ?? null,
        valor_servicos: inv.valor_servicos ?? null,
        valor_total: inv.valor_total ?? inv.valor_servicos ?? null,
        xml_path: xmlPath,
        pdf_path: pdfPath,
      });
      if (insErr) throw insErr;

      await admin.from("download_jobs")
        .update({ downloaded_invoices: (job.downloaded_invoices ?? 0) + 1 })
        .eq("id", job.id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "cancel_invoice") {
      if (typeof body.chave_acesso !== "string" || !/^\d{50}$/.test(body.chave_acesso)) throw new Error("Invalid cancellation key");
      await markCancelled(admin, job, body.chave_acesso);
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "finish") {
      // O total é o que foi realmente gravado, não o que o worker diz ter visto.
      // (inclui notas já existentes que foram apenas atualizadas; eventos não contam).
      await admin.from("download_jobs").update({
        status: "completed",
        finished_at: new Date().toISOString(),
        total_invoices: job.downloaded_invoices ?? 0,
      }).eq("id", job.id);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "fail") {
      await admin.from("download_jobs").update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: body.error_message ?? "Unknown error",
      }).eq("id", job.id);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
