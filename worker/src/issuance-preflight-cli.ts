import 'dotenv/config';
import { z } from 'zod';
import { inspectIssuanceCertificate } from './issuance-preflight.js';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

async function main() {
  const configuration = z.object({
    SUPABASE_FUNCTIONS_URL: z.string().url(), WORKER_SHARED_SECRET: z.string().min(1),
    ISSUANCE_COMPANY_ID: z.string().uuid().optional(), ISSUANCE_CERTIFICATE_ID: z.string().uuid().optional(),
  }).safeParse(process.env);
  if (!configuration.success) throw new Error('configuration');
  const env = configuration.data;
  const url = new URL(`${env.SUPABASE_FUNCTIONS_URL.replace(/\/$/, '')}/issuance-preflight-material`);
  if (url.protocol !== 'https:') throw new Error('https required');
  const call = (body: unknown) => fetch(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { 'content-type': 'application/json', 'x-worker-secret': env.WORKER_SHARED_SECRET },
    body: JSON.stringify(body),
  });
  let companyId = env.ISSUANCE_COMPANY_ID;
  let certificateId = env.ISSUANCE_CERTIFICATE_ID;
  if (!companyId || !certificateId) {
    const response = await call({ action: 'options' });
    if (!response.ok) throw new Error('options unavailable');
    const options = z.object({
      companies: z.array(z.object({ id: z.string().uuid(), owner_id: z.string().uuid(), legal_name: z.string(), cnpj: z.string() })),
      certificates: z.array(z.object({ id: z.string().uuid(), owner_id: z.string().uuid(), company_id: z.string().uuid().nullable(), is_procurador: z.boolean(), expires_at: z.string().nullable(), label: z.string() })),
    }).parse(await response.json());
    const prompt = createInterface({ input: stdin, output: stdout });
    try {
      const select = async <T>(items: T[], label: (item: T) => string) => {
        if (!items.length) throw new Error('no options');
        items.forEach((item, index) => console.log(`${index + 1}. ${label(item).replace(/[\x00-\x1f\x7f-\x9f]/g, '')}`));
        const answer = await prompt.question('Escolha o número: ');
        if (!/^\d+$/.test(answer)) throw new Error('invalid selection');
        const item = items[Number(answer) - 1];
        if (!item) throw new Error('invalid selection');
        return item;
      };
      console.log('Diagnóstico sem envio de nota. Selecione a empresa:');
      const company = await select(options.companies, c => `${c.legal_name} · ${c.cnpj}`);
      console.log('Selecione o certificado:');
      const certificate = await select(options.certificates.filter(c => c.owner_id === company.owner_id && (c.is_procurador || c.company_id === company.id) && (!c.expires_at || Date.parse(c.expires_at) > Date.now())), c => c.label);
      companyId = company.id;
      certificateId = certificate.id;
    } finally { prompt.close(); }
  }
  const response = await call({ company_id: companyId, certificate_id: certificateId });
  if (!response.ok) throw new Error('material unavailable');
  const parsed = z.object({ pfx_base64: z.string().min(1).max(14000000), password: z.string(), production_ready: z.literal(false) }).parse(await response.json());
  // Only categorical results are logged. No subject, filename, password or certificate bytes.
  const result = inspectIssuanceCertificate(parsed.pfx_base64, parsed.password);
  console.log(JSON.stringify(result, null, 2));
  if (!result.local_signature_valid) process.exitCode = 1;
}

main().catch(() => {
  console.error('Diagnóstico não concluído. Confira a configuração, acesso e certificado, sem enviar senhas nos registros.');
  process.exitCode = 1;
});