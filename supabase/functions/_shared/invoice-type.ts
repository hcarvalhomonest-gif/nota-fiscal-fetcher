export function classifyInvoice(prestador: unknown, tomador: unknown, companyCnpj: string): "emitida" | "tomada" | null {
  const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
  const cnpj = digits(companyCnpj);
  if (!cnpj) return null;
  if (digits(prestador) === cnpj) return "emitida";
  if (digits(tomador) === cnpj) return "tomada";
  return null;
}

export function matchesInvoiceType(requested: string, actual: string | null) {
  return actual !== null && (requested === "ambas" || requested === actual);
}