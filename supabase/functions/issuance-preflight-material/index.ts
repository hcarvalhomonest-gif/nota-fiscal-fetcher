import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';
import { certificateCanIssue } from '../_shared/issuance-rules.ts';
import { certificateLabel } from '../_shared/certificate-label.ts';

const schema = z.union([z.object({ action: z.literal('options') }).strict(), z.object({ company_id: z.string().uuid(), certificate_id: z.string().uuid() }).strict()]);
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

// Worker-only, read-only certificate delivery. Never allocates a DPS, queues or sends an invoice.
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return reply({ error: 'Método não permitido.' }, 405);
  const secret = Deno.env.get('WORKER_SHARED_SECRET');
  if (!secret || req.headers.get('x-worker-secret') !== secret) return reply({ error: 'Acesso negado.' }, 403);
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return reply({ error: 'Dados inválidos.' }, 400);
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const passwordKey = Deno.env.get('CERT_PASSWORD_KEY');
    if (!url || !serviceKey || !passwordKey) return reply({ error: 'Serviço indisponível.' }, 503);
    const admin = createClient(url, serviceKey);
    if ('action' in parsed.data) {
      const { data: companies, error: companyError } = await admin.from('companies').select('id,owner_id,legal_name,cnpj').order('legal_name').limit(500);
      const { data: certificates, error: certError } = await admin.from('certificates').select('id,owner_id,company_id,is_procurador,is_active,expires_at,subject_name,storage_path').eq('is_active', true).limit(500);
      if (companyError || certError) return reply({ error: 'Opções indisponíveis.' }, 503);
      return reply({ companies, certificates: certificates?.map(cert => ({ id: cert.id, owner_id: cert.owner_id, company_id: cert.company_id, is_procurador: cert.is_procurador, expires_at: cert.expires_at, label: certificateLabel(cert) })), production_ready: false });
    }
    const { data: company, error: companyError } = await admin.from('companies').select('id,owner_id').eq('id', parsed.data.company_id).maybeSingle();
    const { data: cert, error: certError } = await admin.from('certificates').select('id,owner_id,company_id,is_procurador,is_active,expires_at,storage_path,password_encrypted,password_iv').eq('id', parsed.data.certificate_id).maybeSingle();
    if (companyError || certError || !company || !cert || company.owner_id !== cert.owner_id || !certificateCanIssue(cert, company.id)) return reply({ error: 'Empresa ou certificado indisponível.' }, 403);
    const { data: file, error: fileError } = await admin.storage.from('certificates').download(cert.storage_path);
    if (fileError || !file || file.size > 10000000) return reply({ error: 'Certificado indisponível.' }, 409);
    const key = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode(passwordKey)), 'AES-GCM', false, ['decrypt']);
    const decode = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
    const password = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(cert.password_iv) }, key, decode(cert.password_encrypted)));
    let binary = '';
    for (const byte of new Uint8Array(await file.arrayBuffer())) binary += String.fromCharCode(byte);
    return reply({ pfx_base64: btoa(binary), password, production_ready: false });
  } catch {
    return reply({ error: 'Não foi possível preparar o diagnóstico.' }, 400);
  }
});