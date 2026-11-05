// Detecção de eventos da NFS-e Nacional (ADN) a partir da árvore XML já
// convertida em objeto (fast-xml-parser com removeNSPrefix e parseTagValue=false).
//
// No ADN o evento vem como:
//   <evento><infEvento>…<pedRegEvento><infPedReg>
//       <chNFSe>50 dígitos</chNFSe>
//       <e101101>…</e101101>          ← tipo do evento = nome do grupo
//   </infPedReg></pedRegEvento></infEvento></evento>
// Por isso a busca é recursiva: os campos ficam em níveis diferentes conforme a versão.

/** Eventos que efetivamente cancelam a nota (pedidos de análise não contam). */
const CANCEL_CODES = ["101101", "105102", "105104"]; // cancelamento, por substituição, deferido em análise fiscal
const EVENT_ROOTS = ["procEventoNFSe", "evento", "pedRegEvento", "infEvento", "infPedReg"];

function findKey(node: unknown, predicate: (key: string, value: unknown) => boolean, depth = 0): [string, unknown] | null {
  if (!node || typeof node !== "object" || depth > 12) return null;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (predicate(k, v)) return [k, v];
    const found = findKey(v, predicate, depth + 1);
    if (found) return found;
  }
  return null;
}

const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");

export type NfseEventInfo = { isEvent: boolean; cancelledKey: string | null };

export function readNfseEvent(tree: unknown, envelope?: { tpEvento?: string | null; chNFSe?: string | null }): NfseEventInfo {
  const hasInvoice = !!findKey(tree, (k) => k === "infNFSe");
  const hasEventRoot = !!findKey(tree, (k) => EVENT_ROOTS.includes(k));
  const isEvent = (hasEventRoot && !hasInvoice) || (!!envelope?.tpEvento && !hasInvoice);
  if (!isEvent) return { isEvent: false, cancelledKey: null };

  const groupHit = findKey(tree, (k) => CANCEL_CODES.some((c) => k === `e${c}`));
  const tpHit = findKey(tree, (k, v) => k === "tpEvento" && CANCEL_CODES.some((c) => text(v).includes(c)));
  const envelopeCancel = CANCEL_CODES.some((c) => text(envelope?.tpEvento).includes(c));
  const cancelled = !!groupHit || !!tpHit || envelopeCancel;

  const keyHit = findKey(tree, (k, v) => k === "chNFSe" && /^\d{50}$/.test(text(v)));
  const key = keyHit ? text(keyHit[1]) : /^\d{50}$/.test(text(envelope?.chNFSe)) ? text(envelope?.chNFSe) : null;
  return { isEvent: true, cancelledKey: cancelled && key ? key : null };
}
