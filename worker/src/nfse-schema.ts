/**
 * Schemas Zod para validação estrita das respostas do ADN (Sistema Nacional NFS-e)
 * e tipos derivados do leiaute oficial.
 *
 * Referências oficiais:
 *   - Manual Integrado SN NFS-e v1.00.02
 *     https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/leiaute-e-esquemas-antigos/manualintegradosnnfse_v1-00-02-producao.pdf
 *   - Manual dos Contribuintes — Emissor Público v1.2 (out/2025)
 *     https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/
 *   - APIs (Swagger): https://adn.nfse.gov.br/contribuintes/docs/index.html
 */

import { z } from "zod";

// ---------- Helpers ----------

/** Aceita string ou number e devolve number (alguns campos vêm como string). */
const numLike = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)]).transform(Number);

/** Inteiro ou string numérica (NSU costuma ser inteiro grande). */
const intLike = z
  .union([z.number().int(), z.string().regex(/^\d+$/)])
  .transform((v) => (typeof v === "number" ? v : Number(v)));

/** ISO-8601 ou data simples — validamos só o formato básico, sem parsear timezone. */
const isoDateTime = z
  .string()
  .min(10)
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "Data inválida (esperado ISO-8601)",
  });

/** Chave de acesso da NFS-e Nacional: 50 dígitos (leiaute oficial). */
export const chaveAcessoSchema = z
  .string()
  .regex(/^\d{50}$/, "ChaveAcesso deve ter 50 dígitos");

// ---------- LoteDFe ----------

/**
 * Item retornado em GET /contribuintes/dfe/{nsu}?cnpjConsulta=...&lote=true
 *
 * Campos confirmados pela doc/lib `dfe-nfse`:
 *   - NSU              (int)   Número Sequencial Único
 *   - ChaveAcesso      (str)   50 dígitos
 *   - DataHoraGeracao  (str)   ISO-8601
 *   - ArquivoXml       (str)   base64(gzip(xml))
 *
 * Campos opcionais que aparecem em parte das respostas:
 *   - tpEvento         (str)   tipo do evento (quando o item é um evento, não NFS-e)
 *   - nSeqEvento       (int)   número sequencial do evento
 *   - chNFSe           (str)   chave da NFS-e relacionada ao evento
 */
export const loteDFeItemSchema = z
  .object({
    NSU: intLike,
    ChaveAcesso: chaveAcessoSchema.optional(),
    DataHoraGeracao: isoDateTime,
    ArquivoXml: z.string().min(1),
    // Eventos (cancelamento, substituição, etc.)
    tpEvento: z.string().optional(),
    nSeqEvento: intLike.optional(),
    chNFSe: chaveAcessoSchema.optional(),
  })
  .passthrough(); // tolera campos novos do ADN sem quebrar

export const loteDFeResponseSchema = z
  .object({
    LoteDFe: z.array(loteDFeItemSchema).default([]),
  })
  .passthrough();

export type LoteDFeItem = z.infer<typeof loteDFeItemSchema>;
export type LoteDFeResponse = z.infer<typeof loteDFeResponseSchema>;

// ---------- NFS-e (campos mapeados do XML) ----------

/**
 * Subconjunto dos campos do leiaute nacional NFS-e que mapeamos para a UI.
 * Todos opcionais — nem toda nota traz tudo (ex.: locação não tem `cServ`).
 */
export const nfseMappedSchema = z.object({
  // Identificação
  chaveAcesso: chaveAcessoSchema.optional().nullable(),
  numero: z.string().nullable(),
  serie: z.string().nullable(),
  dhEmi: z.string().nullable(),
  dhProc: z.string().nullable(),
  tpAmb: z.string().nullable(), // 1=produção, 2=homologação
  verAplic: z.string().nullable(),

  // Prestador (emit)
  prestadorCnpj: z.string().nullable(),
  prestadorRazao: z.string().nullable(),
  prestadorIm: z.string().nullable(), // Inscrição Municipal

  // Tomador (toma)
  tomadorTipoDoc: z.enum(["CNPJ", "CPF", "NIF", "OUTRO"]).nullable(),
  tomadorDoc: z.string().nullable(),
  tomadorRazao: z.string().nullable(),
  tomadorEmail: z.string().nullable(),

  // Serviço
  cServ: z.string().nullable(), // código tributação municipal (LC 116)
  cnae: z.string().nullable(),
  xDescServ: z.string().nullable(),

  // Município de incidência
  cMunIncid: z.string().nullable(),
  xMunIncid: z.string().nullable(),
  cPaisIncid: z.string().nullable(),

  // Valores
  vServ: z.number().nullable(),
  vDeducoes: z.number().nullable(),
  vBC: z.number().nullable(),
  pAliq: z.number().nullable(),
  vISSQN: z.number().nullable(),
  vLiq: z.number().nullable(),

  // Status
  cancelada: z.boolean(),
});

export type NfseMapped = z.infer<typeof nfseMappedSchema>;
