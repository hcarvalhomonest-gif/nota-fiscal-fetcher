export type IssuanceStatus = 'draft' | 'queued' | 'processing' | 'authorized' | 'rejected' | 'uncertain';
export type IssuanceCertificate = { id: string; company_id: string | null; is_procurador: boolean; is_active: boolean; expires_at: string | null };

export function certificateCanIssue(cert: IssuanceCertificate, companyId: string, now = Date.now()) {
  return cert.is_active && (cert.is_procurador || cert.company_id === companyId)
    && (!cert.expires_at || Date.parse(cert.expires_at) > now);
}

export function canEditIssuance(status: IssuanceStatus) {
  return status === 'draft' || status === 'rejected';
}

export function confirmationBlockers(input: {
  status: IssuanceStatus; confirmed: boolean; certificateEligible: boolean;
  fiscalConfigured: boolean; integrationVerified: boolean;
}) {
  const blockers: string[] = [];
  if (!canEditIssuance(input.status)) blockers.push('Esta solicitação já foi enviada ou aguarda consulta do resultado.');
  if (!input.confirmed) blockers.push('Confirme expressamente a emissão com validade fiscal.');
  if (!input.certificateEligible) blockers.push('Escolha um certificado ativo, válido e acessível para esta empresa.');
  if (!input.fiscalConfigured) blockers.push('Complete a configuração fiscal da empresa.');
  if (!input.integrationVerified) blockers.push('Emissão real bloqueada: assinatura, autorização e processamento na VPS ainda não foram validados.');
  return blockers;
}

export function validateIssuanceData(data: Record<string, unknown>, complete = false) {
  const errors: string[] = [];
  const s = (key: string) => typeof data[key] === 'string' ? data[key] as string : '';
  const date = s('competence');
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date)) errors.push('Competência inválida.');
  if (s('customer_document') && !/^\d{11}$|^\d{14}$/.test(s('customer_document').replace(/\D/g, ''))) errors.push('Informe CPF ou CNPJ do tomador.');
  for (const field of ['service_municipality', 'customer_municipality']) {
    if (s(field) && !/^\d{7}$/.test(s(field))) errors.push('O código IBGE deve ter 7 dígitos.');
  }
  if (s('national_service_code') && !/^\d{6}$/.test(s('national_service_code'))) errors.push('O código de tributação nacional deve ter 6 dígitos.');
  if (data.amount !== undefined && (typeof data.amount !== 'number' || !Number.isFinite(data.amount) || data.amount < 0)) errors.push('Valor de serviço inválido.');
  if (data.iss_rate !== undefined && data.iss_rate !== null && (typeof data.iss_rate !== 'number' || data.iss_rate < 0 || data.iss_rate > 100)) errors.push('Alíquota de ISS inválida.');
  if (complete) {
    for (const field of ['competence','customer_document','customer_name','service_municipality','national_service_code','description']) {
      if (!s(field).trim()) errors.push('Complete competência, tomador e dados do serviço antes de emitir.');
    }
    if (typeof data.amount !== 'number' || data.amount <= 0) errors.push('O valor de serviço deve ser maior que zero.');
  }
  return [...new Set(errors)];
}