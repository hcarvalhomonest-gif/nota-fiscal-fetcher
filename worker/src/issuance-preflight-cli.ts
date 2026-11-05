import 'dotenv/config';
import { z } from 'zod';
import { inspectIssuanceCertificate } from './issuance-preflight.js';

async function main() {
  const configuration = z.object({
    SUPABASE_FUNCTIONS_URL: z.string().url(), WORKER_SHARED_SECRET: z.string().min(1),
    ISSUANCE_COMPANY_ID: z.string().uuid(), ISSUANCE_CERTIFICATE_ID: z.string().uuid(),
  }).safeParse(process.env);
  if (!configuration.success) throw new Error('configuration');
  const env = configuration.data;
  const url = new URL(`${env.SUPABASE_FUNCTIONS_URL.replace(/\/$/, '')}/issuance-preflight-material`);
  if (url.protocol !== 'https:') throw new Error('https required');
  const response = await fetch(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { 'content-type': 'application/json', 'x-worker-secret': env.WORKER_SHARED_SECRET },
    body: JSON.stringify({ company_id: env.ISSUANCE_COMPANY_ID, certificate_id: env.ISSUANCE_CERTIFICATE_ID }),
  });
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