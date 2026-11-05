// Shared label policy never displays certificate filenames.
export function certificateLabel(cert: { is_procurador: boolean; subject_name: string | null; storage_path?: string; id: string }) {
  const identity = `${cert.subject_name ?? ''} ${cert.storage_path ?? ''}`;
  if (cert.is_procurador && /antiga|hc[ _-]*contabilidade/i.test(identity)) return 'Monest antiga HC';
  if (cert.is_procurador && /consultoria|nova/i.test(identity)) return 'Monest nova';
  return cert.is_procurador ? `Monest · ${cert.id.slice(0, 8)}` : 'Certificado do cliente';
}