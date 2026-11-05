export type InvoiceType = "emitida" | "tomada";

export function certificateLabel(cert: { is_procurador: boolean; subject_name: string | null; storage_path?: string; id: string }) {
  const identity = `${cert.subject_name ?? ""} ${cert.storage_path ?? ""}`;
  if (cert.is_procurador && /antiga|hc[ _-]*contabilidade/i.test(identity)) return "Monest antiga HC";
  if (cert.is_procurador && /consultoria|nova/i.test(identity)) return "Monest nova";
  return cert.is_procurador ? `Monest · ${cert.id.slice(0, 8)}` : cert.subject_name || "Certificado do cliente";
}

export function invoiceStatus(cancelada: boolean | null | undefined) {
  return cancelada === true ? "Cancelada" : cancelada === false ? "Ativa" : "Não informada";
}

export function isMonthOpen(months: Record<string, boolean>, key: string) {
  return months[key] ?? false;
}