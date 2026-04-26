/**
 * Parser robusto do XML padrão nacional da NFS-e usando fast-xml-parser.
 *
 * O leiaute oficial (Manual Integrado SN NFS-e v1.00.02) define um envelope
 * `<NFSe>` contendo `<infNFSe>` com:
 *   xLocEmi, xLocPrestacao, nNFSe, dhProc, ...
 *   <emit>...</emit>          → prestador
 *   <DPS><infDPS>             → declaração original (dhEmi, série, ...)
 *     <prest>, <toma>, <serv>, <valores>...
 *
 * O ADN também devolve eventos (cancelamento, substituição). Quando o item é
 * um evento, o XML tem `<procEventoNFSe>` em vez de `<NFSe>`.
 */

import { XMLParser } from "fast-xml-parser";
import { type NfseMapped, nfseMappedSchema } from "./nfse-schema.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: true,
  trimValues: true,
  removeNSPrefix: true, // remove `nfse:`, `ds:` etc. para simplificar o acesso
});

// ---------- helpers ----------

const asString = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
};

const asNumber = (v: unknown): number | null => {
  const s = asString(v);
  if (s === null) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const pick = (obj: unknown, ...path: string[]): unknown => {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
};

/** Retorna o primeiro valor não-nulo de um conjunto de caminhos alternativos. */
const firstOf = (obj: unknown, paths: string[][]): unknown => {
  for (const p of paths) {
    const v = pick(obj, ...p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};

// ---------- Tipo de documento do tomador ----------

function readTomador(toma: unknown): {
  tipoDoc: NfseMapped["tomadorTipoDoc"];
  doc: string | null;
  razao: string | null;
  email: string | null;
} {
  if (!toma || typeof toma !== "object") {
    return { tipoDoc: null, doc: null, razao: null, email: null };
  }
  const t = toma as Record<string, unknown>;
  // O leiaute usa <CNPJ> | <CPF> | <NIF> dentro de um <IdToma> ou direto
  const idBlock = (t.IdToma as Record<string, unknown> | undefined) ?? t;
  let tipoDoc: NfseMapped["tomadorTipoDoc"] = null;
  let doc: string | null = null;
  for (const k of ["CNPJ", "CPF", "NIF"] as const) {
    const v = asString(idBlock[k]);
    if (v) {
      tipoDoc = k;
      doc = v;
      break;
    }
  }
  return {
    tipoDoc,
    doc,
    razao: asString(t.xNome) ?? asString(t.RazaoSocial),
    email: asString(t.email) ?? asString(t.Email) ?? asString(pick(t, "endNac", "email")),
  };
}

function readPrestador(emit: unknown): {
  cnpj: string | null;
  razao: string | null;
  im: string | null;
} {
  if (!emit || typeof emit !== "object") return { cnpj: null, razao: null, im: null };
  const e = emit as Record<string, unknown>;
  return {
    cnpj: asString(e.CNPJ) ?? asString(pick(e, "IdEmit", "CNPJ")) ?? asString(e.CPF),
    razao: asString(e.xNome) ?? asString(e.RazaoSocial),
    im: asString(e.IM) ?? asString(e.InscricaoMunicipal),
  };
}

// ---------- Detecção de cancelamento ----------

function detectCancelado(root: unknown): boolean {
  // 1) procEventoNFSe com tpEvento = 101000 (cancelamento) → o item É o evento
  const tpEvento =
    asString(pick(root, "procEventoNFSe", "evento", "infEvento", "tpEvento")) ??
    asString(pick(root, "evento", "infEvento", "tpEvento"));
  if (tpEvento && /101000|cancelamento/i.test(tpEvento)) return true;

  // 2) NFS-e regular pode ter <NFSeCanc> ou status no infNFSe
  if (pick(root, "NFSe", "NFSeCanc") || pick(root, "NFSeCanc")) return true;
  return false;
}

// ---------- Parser principal ----------

export function parseNfseXml(xmlText: string): NfseMapped {
  const tree = parser.parse(xmlText);

  // Pode vir como NFSe direto, dentro de <nfseProc>, ou como evento
  const infNFSe =
    pick(tree, "NFSe", "infNFSe") ??
    pick(tree, "nfseProc", "NFSe", "infNFSe") ??
    pick(tree, "infNFSe");

  const infDPS =
    pick(infNFSe, "DPS", "infDPS") ??
    pick(tree, "DPS", "infDPS") ??
    pick(tree, "nfseProc", "DPS", "infDPS");

  const emit = pick(infDPS, "emit") ?? pick(infNFSe, "emit");
  const toma = pick(infDPS, "toma") ?? pick(infNFSe, "toma");
  const serv = pick(infDPS, "serv") ?? pick(infNFSe, "serv");
  const valores = pick(infDPS, "valores") ?? pick(infNFSe, "valores");

  // Chave de acesso: pode estar em atributo Id="NFSe..." ou tag dedicada
  const idAttr =
    asString(pick(infNFSe, "@_Id")) ??
    asString(pick(tree, "NFSe", "@_Id")) ??
    asString(pick(tree, "nfseProc", "NFSe", "@_Id"));
  const chaveDoId = idAttr ? idAttr.replace(/^NFSe/, "") : null;
  const chave =
    asString(pick(infNFSe, "chNFSe")) ??
    asString(pick(tree, "chNFSe")) ??
    chaveDoId;

  const prest = readPrestador(emit);
  const tom = readTomador(toma);

  const mapped: NfseMapped = {
    chaveAcesso: chave && /^\d{50}$/.test(chave) ? chave : null,
    numero: asString(pick(infNFSe, "nNFSe")) ?? asString(pick(infDPS, "nDPS")),
    serie: asString(pick(infDPS, "serie")) ?? asString(pick(infNFSe, "serie")),
    dhEmi: asString(pick(infDPS, "dhEmi")) ?? asString(pick(infNFSe, "dhEmi")),
    dhProc: asString(pick(infNFSe, "dhProc")),
    tpAmb: asString(pick(infNFSe, "tpAmb")) ?? asString(pick(infDPS, "tpAmb")),
    verAplic: asString(pick(infNFSe, "verAplic")),

    prestadorCnpj: prest.cnpj,
    prestadorRazao: prest.razao,
    prestadorIm: prest.im,

    tomadorTipoDoc: tom.tipoDoc,
    tomadorDoc: tom.doc,
    tomadorRazao: tom.razao,
    tomadorEmail: tom.email,

    cServ:
      asString(pick(serv, "cServ", "cTribMun")) ??
      asString(pick(serv, "locPrest", "cTribMun")) ??
      asString(pick(serv, "cTribMun")),
    cnae:
      asString(pick(serv, "cServ", "cNAE")) ?? asString(pick(serv, "cNAE")),
    xDescServ:
      asString(pick(serv, "cServ", "xDescServ")) ??
      asString(pick(serv, "xDescServ")) ??
      asString(pick(serv, "Discriminacao")),

    cMunIncid:
      asString(pick(serv, "locPrest", "cLocPrestacao")) ??
      asString(pick(serv, "cMunIncid")) ??
      asString(pick(infNFSe, "xLocIncid", "cMun")),
    xMunIncid:
      asString(pick(infNFSe, "xLocPrestacao")) ??
      asString(pick(infNFSe, "xLocIncid", "xMun")),
    cPaisIncid: asString(pick(serv, "locPrest", "cPaisPrestacao")),

    vServ: asNumber(firstOf(valores, [["vServPrest", "vServ"], ["vServ"]])),
    vDeducoes: asNumber(firstOf(valores, [["vDescIncond"], ["vDeducoes"]])),
    vBC: asNumber(pick(valores, "trib", "tribMun", "vBC")) ?? asNumber(pick(valores, "vBC")),
    pAliq:
      asNumber(pick(valores, "trib", "tribMun", "pAliq")) ??
      asNumber(pick(valores, "pAliq")),
    vISSQN:
      asNumber(pick(valores, "trib", "tribMun", "vISSQN")) ??
      asNumber(pick(valores, "vISSQN")),
    vLiq: asNumber(firstOf(valores, [["vLiq"], ["vNF"]])),

    cancelada: detectCancelado(tree),
  };

  // valida com zod (não lança em produção: log e segue com o melhor esforço)
  const parsed = nfseMappedSchema.safeParse(mapped);
  if (!parsed.success) {
    console.warn("nfseMappedSchema validation issues:", parsed.error.issues.slice(0, 3));
  }
  return mapped;
}
