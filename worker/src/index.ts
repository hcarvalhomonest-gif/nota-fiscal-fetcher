/**
 * NotaSync Worker — Sistema Nacional NFS-e (ADN)
 * ------------------------------------------------
 * Roda numa VPS sua. Faz polling em /worker-claim-job, recebe o certificado
 * A1 (PFX em base64) + senha + período, autentica no Ambiente de Dados
 * Nacional (ADN) da Receita Federal via mTLS e baixa em lote os XMLs
 * (descompactando o gzip) e os PDFs (DANFSe) de cada NFS-e emitida no
 * período. Reporta cada nota e o resultado final via /worker-report.
 *
 * Protocolo real do ADN (validado contra a doc oficial e a lib python
 * `dfe-nfse`):
 *
 *   GET https://adn.nfse.gov.br/contribuintes/dfe/{nsu}?cnpjConsulta={cnpj}&lote=true
 *     -> 200 { "LoteDFe": [
 *           { "NSU": <int>, "ChaveAcesso": "...", "DataHoraGeracao": "ISO-8601",
 *             "ArquivoXml": "<base64(gzip(xml))>" }, ...
 *        ] }
 *     -> 404 quando não há mais documentos a partir daquele NSU
 *
 *   GET https://adn.nfse.gov.br/danfse/{chave}
 *     -> 200 application/pdf
 *
 * Observações:
 *  - A consulta é paginada por NSU (Número Sequencial Único), não por data.
 *    O período pedido pelo usuário é aplicado sobre o campo de emissão lido
 *    do XML (`dhEmi` / `DataHoraGeracao`).
 *  - O XML vem dentro do JSON, base64-encoded e comprimido com gzip.
 *  - Em produção restrita (homologação), troque NFSE_BASE_URL para
 *    https://adn.producaorestrita.nfse.gov.br
 *
 * Doc oficial: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao
 */

import "dotenv/config";
import { gunzipSync } from "node:zlib";
import * as tls from "node:tls";
import { Agent, fetch as undiciFetch } from "undici";
import forge from "node-forge";
import { ZodError } from "zod";
import {
  loteDFeResponseSchema,
  type LoteDFeItem,
  type LoteDFeResponse,
} from "./nfse-schema.js";
import { parseNfseXml } from "./nfse-parse.js";

const {
  SUPABASE_FUNCTIONS_URL,
  WORKER_SHARED_SECRET,
  NFSE_BASE_URL = "https://adn.nfse.gov.br",
  POLL_INTERVAL_MS = "10000",
  MAX_PAGES = "1000",
  REQUEST_DELAY_MS = "250",
} = process.env;

if (!SUPABASE_FUNCTIONS_URL || !WORKER_SHARED_SECRET) {
  console.error("Set SUPABASE_FUNCTIONS_URL and WORKER_SHARED_SECRET in .env");
  process.exit(1);
}

const POLL_MS = parseInt(POLL_INTERVAL_MS, 10);
const MAX_PAGES_N = parseInt(MAX_PAGES, 10);
const REQ_DELAY = parseInt(REQUEST_DELAY_MS, 10);

// ---------- Tipos ----------
interface JobPayload {
  job: {
    id: string;
    worker_token: string;
    owner_id: string;
    period_start: string; // YYYY-MM-DD
    period_end: string;   // YYYY-MM-DD
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

// LoteDFeItem / LoteDFeResponse importados de ./nfse-schema (validados com zod)

// ---------- Helpers ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normalizarCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, "");
}

/** Converte PFX (PKCS#12) em PEM (cert + key + CA chain) usando node-forge. */
function pfxToPem(pfxBase64: string, password: string): ParsedPfx {
  const pfxDer = forge.util.decode64(pfxBase64);
  const p12Asn1 = forge.asn1.fromDer(pfxDer);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

  const certBags =
    p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const keyBags =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] ??
    p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ??
    [];

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

/** Cria um Agent do undici com mTLS configurado (cadeia ICP-Brasil). */
function createMtlsAgent(pfx: ParsedPfx): Agent {
  // Junta os CAs do sistema (Mozilla bundle do Node) com os CAs intermediários
  // que vieram dentro do .pfx — necessário para validar a cadeia ICP-Brasil
  // do servidor adn.nfse.gov.br.
  const systemCAs = tls.rootCertificates;
  const allCAs = [...systemCAs, ...pfx.caPems];
  return new Agent({
    connect: {
      cert: pfx.certPem,
      key: pfx.keyPem,
      ca: allCAs,
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
  return Buffer.from(u8).toString("base64");
}

/** Descomprime ArquivoXml (base64 -> gzip -> utf-8). */
function descompactarXml(arquivoXmlB64: string): { xmlText: string; xmlBytes: Uint8Array } {
  const gzipped = Buffer.from(arquivoXmlB64, "base64");
  const xmlBuf = gunzipSync(gzipped);
  return { xmlText: xmlBuf.toString("utf8"), xmlBytes: new Uint8Array(xmlBuf) };
}

/** True se a data ISO `iso` cai dentro de [start, end] (datas YYYY-MM-DD inclusivas). */
function dentroDoPeriodo(iso: string | null, start: string, end: string): boolean {
  if (!iso) return true; // sem data confiável: aceita
  const d = iso.slice(0, 10); // YYYY-MM-DD
  return d >= start && d <= end;
}

// ---------- ADN: paginação por NSU ----------

/**
 * Consulta o ADN paginando por NSU. A cada página, decodifica o XML do lote,
 * filtra pelo período do job, baixa o DANFSe e reporta a nota.
 *
 * Retorna o total de notas reportadas (dentro do período).
 */
async function listAndDownloadInvoices(job: JobPayload, agent: Agent): Promise<number> {
  const { company, job: j } = job;
  const cnpj = normalizarCnpj(company.cnpj);

  // Sempre começamos do NSU 0 — o ADN devolve em ordem crescente. Para um
  // worker incremental no futuro, persistir o último NSU por empresa.
  let nsu = 0;
  let pageCount = 0;
  let totalReportadas = 0;
  let passouDoPeriodo = false;

  while (pageCount < MAX_PAGES_N && !passouDoPeriodo) {
    const url = `${NFSE_BASE_URL}/contribuintes/dfe/${nsu}?cnpjConsulta=${cnpj}&lote=true`;
    console.log("[job", j.id, "] GET", url);

    const res = await undiciFetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      dispatcher: agent,
    });

    // 404 = não há mais documentos a partir desse NSU → fim da paginação
    if (res.status === 404) {
      console.log("[job", j.id, "] fim da paginação (404 a partir do NSU", nsu, ")");
      break;
    }
    if (res.status === 429) {
      console.warn("[job", j.id, "] 429 throttle, aguardando 5s");
      await sleep(5000);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Listagem falhou (NSU ${nsu}): ${res.status} ${await res.text()}`);
    }

    // Validação ESTRITA do envelope com Zod (loga em detalhes e aborta o job
    // se o schema mudar — melhor falhar do que ingerir lixo silenciosamente)
    let data: LoteDFeResponse;
    try {
      const json = await res.json();
      data = loteDFeResponseSchema.parse(json);
    } catch (e) {
      if (e instanceof ZodError) {
        const issues = e.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        throw new Error(`Schema do ADN inválido (NSU ${nsu}): ${issues}`);
      }
      throw e;
    }
    const lotes = data.LoteDFe;
    if (lotes.length === 0) {
      console.log("[job", j.id, "] lote vazio, fim");
      break;
    }

    for (const item of lotes as LoteDFeItem[]) {
      try {
        // Pular eventos (cancelamento/substituição vêm como itens próprios sem
        // ChaveAcesso de NFS-e mas com tpEvento + chNFSe). Atualizamos a nota
        // existente como cancelada via campo `cancelada` quando o XML for da
        // própria NFS-e cancelada (ver parser).
        if (item.tpEvento && !item.ChaveAcesso) {
          console.log(
            "[job", j.id, "] evento ignorado tpEvento=", item.tpEvento,
            "chNFSe=", item.chNFSe, "NSU=", item.NSU,
          );
          continue;
        }

        const { xmlText, xmlBytes } = descompactarXml(item.ArquivoXml);
        const meta = parseNfseXml(xmlText);

        // Coerência: se o JSON traz ChaveAcesso, deve bater com a do XML
        if (item.ChaveAcesso && meta.chaveAcesso && item.ChaveAcesso !== meta.chaveAcesso) {
          console.warn(
            "[job", j.id, "] ChaveAcesso diverge entre envelope e XML",
            { envelope: item.ChaveAcesso, xml: meta.chaveAcesso, nsu: item.NSU },
          );
        }
        const chave = meta.chaveAcesso ?? item.ChaveAcesso ?? null;

        // Preferir a data do XML; cair para DataHoraGeracao do envelope
        const dataRef = meta.dhEmi ?? item.DataHoraGeracao ?? null;

        // Otimização: o ADN entrega em ordem crescente de NSU (≈ ordem de
        // geração). Se já passamos do fim do período, encerra paginação.
        if (dataRef && dataRef.slice(0, 10) > j.period_end) {
          passouDoPeriodo = true;
          break;
        }
        if (!dentroDoPeriodo(dataRef, j.period_start, j.period_end)) {
          continue;
        }

        // Baixar DANFSe (PDF). Se falhar, prossegue só com o XML.
        let pdfB64: string | null = null;
        if (chave) {
          try {
            const pdfRes = await undiciFetch(`${NFSE_BASE_URL}/danfse/${chave}`, {
              method: "GET",
              headers: { Accept: "application/pdf" },
              dispatcher: agent,
            });
            if (pdfRes.ok) {
              pdfB64 = bytesToB64(await pdfRes.arrayBuffer());
            } else {
              console.warn("DANFSe falhou", chave, pdfRes.status);
            }
          } catch (e) {
            console.warn("DANFSe erro", chave, e);
          }
        }

        await report({
          job_id: j.id,
          worker_token: j.worker_token,
          action: "add_invoice",
          invoice: {
            // Identificação
            nsu: item.NSU,
            chave_acesso: chave,
            numero: meta.numero,
            serie: meta.serie,
            data_emissao: dataRef,
            data_processamento: meta.dhProc,
            ambiente: meta.tpAmb,
            // Prestador
            prestador_cnpj: meta.prestadorCnpj,
            prestador_razao: meta.prestadorRazao,
            prestador_im: meta.prestadorIm,
            // Tomador
            tomador_tipo_documento: meta.tomadorTipoDoc,
            tomador_documento: meta.tomadorDoc,
            tomador_nome: meta.tomadorRazao,
            tomador_email: meta.tomadorEmail,
            // Serviço
            codigo_servico: meta.cServ,
            cnae: meta.cnae,
            descricao_servico: meta.xDescServ,
            municipio_codigo: meta.cMunIncid,
            municipio_nome: meta.xMunIncid,
            pais_codigo: meta.cPaisIncid,
            // Valores
            valor_servicos: meta.vServ,
            valor_deducoes: meta.vDeducoes,
            base_calculo: meta.vBC,
            aliquota: meta.pAliq,
            valor_iss: meta.vISSQN,
            valor_total: meta.vLiq,
            // Status
            cancelada: meta.cancelada,
            // Conteúdo
            xml_base64: bytesToB64(xmlBytes),
            pdf_base64: pdfB64,
          },
        });
        totalReportadas++;
        await sleep(REQ_DELAY);
      } catch (e) {
        console.error("falha ao processar item NSU", item.NSU, e);
      }
    }

    // Próxima página: o NSU "alto" do lote atual + 1
    const ultimoNsu = lotes[lotes.length - 1].NSU;
    if (ultimoNsu <= nsu) {
      console.log("[job", j.id, "] NSU não avançou, encerrando");
      break;
    }
    nsu = ultimoNsu;
    pageCount++;
    await sleep(REQ_DELAY);
  }

  return totalReportadas;
}

// ---------- Loop ----------

async function processJob(job: JobPayload) {
  console.log("processing job", job.job.id);
  let agent: Agent | undefined;
  try {
    const pfx = pfxToPem(job.certificate.pfx_base64, job.certificate.password);
    agent = createMtlsAgent(pfx);
    const total = await listAndDownloadInvoices(job, agent);
    await report({
      job_id: job.job.id,
      worker_token: job.job.worker_token,
      action: "finish",
      total_invoices: total,
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
    await sleep(POLL_MS);
  }
}

main();
