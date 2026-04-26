import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// AES-GCM helpers using a server-side master key
async function getKey(): Promise<CryptoKey> {
  const secret = Deno.env.get("CERT_PASSWORD_KEY");
  if (!secret) throw new Error("CERT_PASSWORD_KEY not configured");
  // Derive a 256-bit key from the secret via SHA-256
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptPassword(plain: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ct))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { company_id, password, file_base64, file_name, subject_name, expires_at } = body;

    if (!company_id || !password || !file_base64 || !file_name) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (typeof password !== "string" || password.length < 1 || password.length > 256) {
      return new Response(JSON.stringify({ error: "Invalid password length" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the company belongs to the user (RLS will enforce, but check explicitly)
    const { data: company, error: cErr } = await supabase
      .from("companies").select("id").eq("id", company_id).maybeSingle();
    if (cErr || !company) {
      return new Response(JSON.stringify({ error: "Company not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Upload the .pfx into the user's folder in 'certificates' bucket
    const cleanName = file_name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${user.id}/${company_id}/${Date.now()}_${cleanName}`;
    const bytes = Uint8Array.from(atob(file_base64), (c) => c.charCodeAt(0));

    const { error: upErr } = await supabase.storage
      .from("certificates")
      .upload(path, bytes, { contentType: "application/x-pkcs12", upsert: false });
    if (upErr) {
      return new Response(JSON.stringify({ error: `Upload failed: ${upErr.message}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { ciphertext, iv } = await encryptPassword(password);

    const { data: cert, error: insErr } = await supabase
      .from("certificates")
      .insert({
        company_id,
        owner_id: user.id,
        storage_path: path,
        password_encrypted: ciphertext,
        password_iv: iv,
        subject_name: subject_name ?? null,
        expires_at: expires_at ?? null,
        is_active: true,
      })
      .select()
      .single();

    if (insErr) {
      await supabase.storage.from("certificates").remove([path]);
      return new Response(JSON.stringify({ error: insErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, certificate: cert }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
