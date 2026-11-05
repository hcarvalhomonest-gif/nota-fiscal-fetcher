import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';
import { ISSUANCE_PRODUCTION_READY, canEditIssuance, certificateCanIssue, confirmationBlockers, validateIssuanceData } from '../_shared/issuance-rules.ts';

const dataSchema = z.object({
  competence: z.string().max(10).optional(), customer_document: z.string().max(18).optional(),
  customer_name: z.string().max(200).optional(), customer_email: z.union([z.string().email(), z.literal('')]).optional(),
  customer_municipality: z.string().max(7).optional(), customer_postal_code: z.string().max(8).optional(),
  customer_street: z.string().max(200).optional(), customer_number: z.string().max(60).optional(),
  customer_district: z.string().max(60).optional(), service_municipality: z.string().max(7).optional(),
  national_service_code: z.string().max(6).optional(), municipal_service_code: z.string().max(20).optional(),
  nbs_code: z.string().max(9).optional(), description: z.string().max(2000).optional(),
  amount: z.number().min(0).max(999999999999.99).optional(),
  iss_rate: z.number().min(0).max(100).nullable().optional(),
  iss_taxation: z.enum(['1','2','3','4']).optional(), iss_retention: z.enum(['1','2','3']).optional(),
}).strict();
const settingsSchema = z.object({
  municipality_code: z.string().regex(/^\d{7}$/), municipal_registration: z.string().max(20).nullable(),
  tax_regime: z.enum(['mei','simples','normal']), special_tax_regime: z.enum(['0','1','2','3','4','5','6','9']),
  simples_assessment: z.enum(['1','2','3']).nullable(), dps_series: z.string().regex(/^\d{1,5}$/),
}).strict();
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save_settings'), company_id: z.string().uuid(), settings: settingsSchema }),
  z.object({ action: z.literal('save_draft'), company_id: z.string().uuid(), id: z.string().uuid().optional(), version: z.number().int().positive().optional(), certificate_id: z.string().uuid().nullable(), payload: dataSchema }),
  z.object({ action: z.literal('confirm'), id: z.string().uuid(), version: z.number().int().positive(), confirmed: z.literal(true) }),
  z.object({ action: z.literal('delete_draft'), id: z.string().uuid() }),
  z.object({ action: z.literal('capabilities') }),
  z.object({ action: z.literal('files'), id: z.string().uuid() }),
]);
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return response({ error: 'Método não permitido.' }, 405);
  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization) return response({ error: 'Entre na sua conta.' }, 401);
    const url = Deno.env.get('SUPABASE_URL');
    const anon = Deno.env.get('SUPABASE_ANON_KEY');
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anon || !service) return response({ error: 'Serviço indisponível.' }, 503);
    const client = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return response({ error: 'Sessão inválida.' }, 401);
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) return response({ error: 'Dados inválidos.', details: parsed.error.flatten() }, 400);
    const input = parsed.data;
    // Deliberately fail closed. Production must not be enabled merely by setting an environment variable.
    // Replace only after a verified official adapter, durable DPS allocation and reconciliation are deployed.
    const integrationVerified = ISSUANCE_PRODUCTION_READY;
    if (input.action === 'capabilities') return response({ production_ready: integrationVerified, blockers: ['Assinatura e leiaute oficial precisam ser validados.', 'Programa da VPS ainda não possui emissão validada.', 'Habilitação e procuração para emissão precisam ser conferidas para cada empresa.'] });
    const admin = createClient(url, service);
    if (input.action === 'save_settings' || input.action === 'save_draft') {
      const { data: company, error } = await client.from('companies').select('id,owner_id').eq('id', input.company_id).maybeSingle();
      if (error || !company) return response({ error: 'Empresa não disponível para sua conta.' }, 403);
      if (input.action === 'save_settings') {
        const { error: saveError } = await admin.from('issuance_settings').upsert({ ...input.settings, company_id: company.id, owner_id: company.owner_id, updated_at: new Date().toISOString() });
        if (saveError) throw saveError;
        return response({ success: true });
      }
      const issues = validateIssuanceData(input.payload);
      if (issues.length) return response({ error: issues.join(' ') }, 400);
      if (input.certificate_id) {
        const { data: cert } = await client.from('certificates').select('id,company_id,is_procurador,is_active,expires_at').eq('id', input.certificate_id).maybeSingle();
        if (!cert || !certificateCanIssue(cert, company.id)) return response({ error: 'Certificado inválido para esta empresa.' }, 403);
      }
      if (input.id) {
        const { data: existing } = await client.from('nfse_issuances').select('id,status,version,company_id').eq('id', input.id).maybeSingle();
        if (!existing || existing.company_id !== company.id) return response({ error: 'Rascunho não disponível.' }, 403);
        if (!canEditIssuance(existing.status) || input.version !== existing.version) return response({ error: 'Rascunho alterado ou já enviado. Atualize a página.' }, 409);
        const { data, error } = await admin.from('nfse_issuances').update({ payload: input.payload, certificate_id: input.certificate_id, status: 'draft', error_message: null, version: existing.version + 1, updated_at: new Date().toISOString() }).eq('id', existing.id).eq('version', existing.version).in('status', ['draft','rejected']).select('id,version').maybeSingle();
        if (error) throw error;
        if (!data) return response({ error: 'Rascunho alterado por outra sessão.' }, 409);
        return response({ success: true, draft: data });
      }
      const { data, error: insertError } = await admin.from('nfse_issuances').insert({ owner_id: user.id, company_id: company.id, certificate_id: input.certificate_id, payload: input.payload }).select('id,version').single();
      if (insertError) throw insertError;
      return response({ success: true, draft: data });
    }
    const { data: item, error } = await client.from('nfse_issuances').select('*').eq('id', input.id).maybeSingle();
    if (error || !item) return response({ error: 'Solicitação não disponível para sua conta.' }, 403);
    if (input.action === 'delete_draft') {
      if (item.status !== 'draft') return response({ error: 'Somente rascunhos podem ser excluídos.' }, 409);
      const { data, error: deleteError } = await admin.from('nfse_issuances').delete().eq('id', item.id).eq('status', 'draft').eq('version', item.version).select('id').maybeSingle();
      if (deleteError) throw deleteError;
      if (!data) return response({ error: 'Solicitação alterada. Atualize a página.' }, 409);
      return response({ success: true });
    }
    if (input.action === 'files') {
      if (item.status !== 'authorized') return response({ error: 'Nota ainda não autorizada.' }, 409);
      // Dedicated private bucket will be created together with the validated issuance adapter.
      return response({ error: 'Arquivos de emissão ainda não disponíveis.' }, 409);
    }
    if (input.version !== item.version) return response({ error: 'Rascunho alterado. Revise novamente.' }, 409);
    const { data: settings } = await client.from('issuance_settings').select('*').eq('company_id', item.company_id).maybeSingle();
    const { data: cert } = item.certificate_id ? await client.from('certificates').select('id,company_id,is_procurador,is_active,expires_at').eq('id', item.certificate_id).maybeSingle() : { data: null };
    const blockers = [...validateIssuanceData(item.payload, true), ...confirmationBlockers({ status: item.status, confirmed: input.confirmed, certificateEligible: !!cert && certificateCanIssue(cert, item.company_id), fiscalConfigured: !!settings, integrationVerified })];
    return response({ error: blockers.join(' '), blockers }, 409);
  } catch (error) {
    if (error instanceof SyntaxError) return response({ error: 'Dados inválidos.' }, 400);
    console.error('issuance-workspace request failed');
    return response({ error: 'Não foi possível salvar a solicitação. Tente novamente.' }, 500);
  }
});