// Endpoint do WORKER para reportar progresso/notas baixadas.
// Auth: X-Worker-Secret + worker_token do job.
// Body: { job_id, worker_token, action: 'add_invoice' | 'finish' | 'fail',
//         invoice?: {...}, error_message?: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

      const { error: insErr } = await admin.from("invoices").insert({
        job_id: job.id,
        owner_id: job.owner_id,
        chave_acesso: inv.chave_acesso ?? null,
        numero: inv.numero ?? null,
        serie: inv.serie ?? null,
        data_emissao: inv.data_emissao ?? null,
        tomador_nome: inv.tomador_nome ?? null,
        tomador_documento: inv.tomador_documento ?? null,
        valor_total: inv.valor_total ?? null,
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

    if (action === "finish") {
      await admin.from("download_jobs").update({
        status: "completed",
        finished_at: new Date().toISOString(),
        total_invoices: body.total_invoices ?? job.downloaded_invoices,
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
