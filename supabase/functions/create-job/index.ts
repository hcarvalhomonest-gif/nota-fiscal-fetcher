import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function genToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: uErr } = await supabase.auth.getUser();
    if (uErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { company_id, certificate_id, period_start, period_end } = await req.json();

    // Basic validation
    if (!company_id || !certificate_id || !period_start || !period_end) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const ds = /^\d{4}-\d{2}-\d{2}$/;
    if (!ds.test(period_start) || !ds.test(period_end)) {
      return new Response(JSON.stringify({ error: "Invalid date format (YYYY-MM-DD)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (new Date(period_start) > new Date(period_end)) {
      return new Response(JSON.stringify({ error: "period_start must be <= period_end" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify company and certificate ownership via RLS
    const { data: cert } = await supabase
      .from("certificates")
      .select("id, company_id, is_active")
      .eq("id", certificate_id)
      .maybeSingle();
    if (!cert || cert.company_id !== company_id || !cert.is_active) {
      return new Response(JSON.stringify({ error: "Invalid certificate for this company" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: job, error: jErr } = await supabase
      .from("download_jobs")
      .insert({
        owner_id: user.id,
        company_id,
        certificate_id,
        period_start,
        period_end,
        status: "pending",
        worker_token: genToken(),
      })
      .select()
      .single();

    if (jErr) {
      return new Response(JSON.stringify({ error: jErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, job }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
