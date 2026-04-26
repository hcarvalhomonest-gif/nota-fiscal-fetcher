// Endpoint chamado pelo WORKER externo (VPS).
// Auth: header X-Worker-Secret == WORKER_SHARED_SECRET
// Faz: pega o próximo job 'pending', marca como 'processing', e devolve o
// certificado (.pfx em base64) + senha em texto puro + período.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-worker-secret",
};

async function decryptPassword(ciphertextB64: string, ivB64: string): Promise<string> {
  const secret = Deno.env.get("CERT_PASSWORD_KEY");
  if (!secret) throw new Error("CERT_PASSWORD_KEY not configured");
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  const key = await crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["decrypt"]);
  const ct = Uint8Array.from(atob(ciphertextB64), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(plain);
}

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

    // Atomically claim one pending job
    const { data: jobs, error: selErr } = await admin
      .from("download_jobs")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1);

    if (selErr) throw selErr;
    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({ job: null }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const job = jobs[0];
    const { error: updErr } = await admin
      .from("download_jobs")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "pending"); // optimistic guard

    if (updErr) throw updErr;

    // Fetch certificate
    const { data: cert, error: cErr } = await admin
      .from("certificates")
      .select("*")
      .eq("id", job.certificate_id)
      .single();
    if (cErr || !cert) throw new Error("Certificate not found");

    const password = await decryptPassword(cert.password_encrypted, cert.password_iv);

    // Download .pfx from storage
    const { data: file, error: dlErr } = await admin.storage
      .from("certificates")
      .download(cert.storage_path);
    if (dlErr || !file) throw new Error("Failed to download certificate file");
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const pfxB64 = btoa(bin);

    // Fetch company info
    const { data: company } = await admin
      .from("companies").select("*").eq("id", job.company_id).single();

    return new Response(JSON.stringify({
      job: {
        id: job.id,
        worker_token: job.worker_token,
        owner_id: job.owner_id,
        period_start: job.period_start,
        period_end: job.period_end,
      },
      company,
      certificate: {
        pfx_base64: pfxB64,
        password,
      },
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
