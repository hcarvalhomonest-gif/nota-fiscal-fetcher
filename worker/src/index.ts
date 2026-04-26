/**
 * NotaSync Worker
 * ----------------
 * Roda numa VPS sua. Faz polling em /worker-claim-job, recebe o certificado
 * A1 (PFX em base64) + senha + período, autentica no portal nacional NFS-e
 * via mTLS, baixa cada NFS-e (XML + DANFSe PDF) e reporta de volta via
 * /worker-report.
 *
 * IMPORTANTE: este é um esqueleto funcional. Os endpoints específicos do
 * portal nacional NFS-e variam conforme o que você precisa consultar
 * (NFS-e por período do prestador, por chave de acesso, etc.). Veja a
 * documentação oficial em:
 *   https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao
 *
 * Adapte a função `listAndDownloadInvoices` para consumir o(s) endpoint(s)
 * que você precisa.
 */

import "dotenv/config";
import { Agent, fetch as undiciFetch } from "undici";
import forge from "node-forge";

const {
  SUPABASE_FUNCTIONS_URL,
  WORKER_SHARED_SECRET,
  NFSE_BASE_URL = "https://sefin.nfse.gov.br/SefinNacional",
  NFSE_DANFSE_URL = "https://adn.nfse.gov.br/danfse",
  POLL_INTERVAL_MS = "10000",
} = process.env;

if (!SUPABASE_FUNCTIONS_URL || !WORKER_SHARED_SECRET) {
  console.error("Set SUPABASE_FUNCTIONS_URL and WORKER_SHARED_SECRET in .env");
  process.exit(1);
}

const POLL_MS = parseInt(POLL_INTERVAL_MS, 10);

// ---------- Tipos ----------
interface JobPayload {
  job: {
    id: string;
    worker_token: string;
    owner_id: string;
    period_start: string; // YYYY-MM-DD
    period_end: string;
  };
  company: {
    id: string;
    cnpj: string;
    legal_name: string;
  };
  certificate: {
    pfx_base64: string;
    password: string;
  };
}

interface ParsedPfx {
  certPem: string;
  keyPem: string;
  caPems: string[];
}

// ---------- Helpers ----------

/** Converte PFX (PKCS#12) em PEM (cert + key + CA chain) usando node-forge. */
function pfxToPem(pfxBase64: string, password: string): ParsedPfx {
  const pfxDer = forge.util.decode64(pfxBase64);
  const p12Asn1 = forge.asn1.fromDer(pfxDer);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const keyBags =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ??
    p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? [];

  if (certBags.length === 0 || keyBags.length === 0) {
    throw new Error("PFX inválido: não foi possível extrair cert/key");
  }
  const cert = certBags[0].cert!;
  const key = keyBags[0].key!;
  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(key);
  const caPems = certBags.slice(1).map((b) => forge.pki.certificateToPem(b.cert!));

  return { certPem, keyPem, caPems };
}

/** Cria um Agent do undici com mTLS configurado. */
function createMtlsAgent(pfx: ParsedPfx): Agent {
  return new Agent({
    connect: {
      cert: pfx.certPem,
      key: pfx.keyPem,
      ca: pfx.caPems.length > 0 ? pfx.caPems.join("\n") : undefined,
      // O portal nacional usa cadeia ICP-Brasil. Em produção, configure as
      // CAs corretas. Para iniciar, mantenha rejectUnauthorized = true.
      rejectUnauthorized: true,
    },
  });
}

async function claimJob(): Promise<JobPayload | null> {
  const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/worker-claim-job`, {
    method: "POST",
    headers: {
      "x-worker-secret": WORKER_SHARED_SECRET!,
      "content-type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok) {
    console.error("claim failed", res.status, await res.text());
    return null;
  }
  const data = (await res.json()) as { job: JobPayload["job"] | null } & Partial<JobPayload>;
  if (!data.job) return null;
  return data as JobPayload;
}

async function report(payload: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/worker-report`, {
    method: "POST",
    headers: {
      "x-worker-secret": WORKER_SHARED_SECRET!,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.error("report failed", res.status, await res.text());
}

function bytesToB64(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return Buffer.from(bin, "binary").toString("base64");
}

// ---------- NFS-e Nacional ----------

/**
 * AQUI VAI A INTEGRAÇÃO REAL.
 *
 * Endpoints típicos do SEFIN Nacional (consulte sempre a doc oficial,
 * pois a Receita atualiza a especificação periodicamente):
 *
 *   GET  {NFSE_BASE_URL}/nfse?cnpj=...&dataInicial=...&dataFinal=...
 *   GET  {NFSE_BASE_URL}/nfse/{chaveAcesso}        -> retorna XML
 *   GET  {NFSE_DANFSE_URL}/danfse/{chaveAcesso}    -> retorna PDF do DANFSe
 *
 * Se o endpoint exigir outro formato, ajuste abaixo.
 */
async function listAndDownloadInvoices(
  job: JobPayload,
  agent: Agent,
): Promise<{ count: number }> {
  const { company, job: j } = job;
  const cnpj = company.cnpj.replace(/\D/g, "");

  // 1) Listar chaves de acesso emitidas no período
  const listUrl = `${NFSE_BASE_URL}/nfse?cnpj=${cnpj}&dataInicial=${j.period_start}&dataFinal=${j.period_end}`;
  console.log("[job", j.id, "] GET", listUrl);

  const listRes = await undiciFetch(listUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
    dispatcher: agent,
  });

  if (!listRes.ok) {
    throw new Error(`Listagem falhou: ${listRes.status} ${await listRes.text()}`);
  }
  // O retorno real precisa ser parseado conforme a doc — aqui assumimos
  // um JSON com `{ chaves: ["3525...","3525..."] }`. ADAPTE.
  const list = (await listRes.json()) as { chaves?: string[]; nfses?: { chaveAcesso: string }[] };
  const chaves = list.chaves ?? list.nfses?.map((n) => n.chaveAcesso) ?? [];
  console.log("[job", j.id, "] notas encontradas:", chaves.length);

  // 2) Para cada chave, baixar XML e PDF e reportar
  let count = 0;
  for (const chave of chaves) {
    try {
      const xmlRes = await undiciFetch(`${NFSE_BASE_URL}/nfse/${chave}`, {
        method: "GET",
        headers: { Accept: "application/xml" },
        dispatcher: agent,
      });
      const xmlBytes = new Uint8Array(await xmlRes.arrayBuffer());

      const pdfRes = await undiciFetch(`${NFSE_DANFSE_URL}/danfse/${chave}`, {
        method: "GET",
        headers: { Accept: "application/pdf" },
        dispatcher: agent,
      });
      const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());

      // Parse mínimo do XML (numero, data, valor, tomador) — opcional.
      const xmlText = new TextDecoder().decode(xmlBytes);
      const numero = /<nNFSe>(.*?)<\/nNFSe>/.exec(xmlText)?.[1] ?? null;
      const dataEm = /<dhEmi>(.*?)<\/dhEmi>/.exec(xmlText)?.[1] ?? null;
      const valor = /<vLiq>(.*?)<\/vLiq>/.exec(xmlText)?.[1] ?? null;
      const tomNome = /<xNome>(.*?)<\/xNome>/.exec(xmlText)?.[1] ?? null;
      const tomDoc =
        /<CNPJ>(.*?)<\/CNPJ>/.exec(xmlText)?.[1] ??
        /<CPF>(.*?)<\/CPF>/.exec(xmlText)?.[1] ?? null;

      await report({
        job_id: j.id,
        worker_token: j.worker_token,
        action: "add_invoice",
        invoice: {
          chave_acesso: chave,
          numero,
          data_emissao: dataEm,
          tomador_nome: tomNome,
          tomador_documento: tomDoc,
          valor_total: valor ? parseFloat(valor) : null,
          xml_base64: bytesToB64(xmlBytes),
          pdf_base64: bytesToB64(pdfBytes),
        },
      });
      count++;
    } catch (e) {
      console.error("falha na nota", chave, e);
    }
  }
  return { count };
}

// ---------- Loop ----------

async function processJob(job: JobPayload) {
  console.log("processing job", job.job.id);
  let agent: Agent | undefined;
  try {
    const pfx = pfxToPem(job.certificate.pfx_base64, job.certificate.password);
    agent = createMtlsAgent(pfx);
    const { count } = await listAndDownloadInvoices(job, agent);
    await report({
      job_id: job.job.id,
      worker_token: job.job.worker_token,
      action: "finish",
      total_invoices: count,
    });
  } catch (e) {
    console.error("job failed", e);
    await report({
      job_id: job.job.id,
      worker_token: job.job.worker_token,
      action: "fail",
      error_message: e instanceof Error ? e.message : "Erro desconhecido",
    });
  } finally {
    await agent?.close();
  }
}

async function main() {
  console.log("NotaSync worker started. Polling every", POLL_MS, "ms");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const job = await claimJob();
      if (job) {
        await processJob(job);
        continue;
      }
    } catch (e) {
      console.error(e);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main();
