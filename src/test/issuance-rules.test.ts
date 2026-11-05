import { describe, expect, it } from 'vitest';
import { certificateCanIssue, confirmationBlockers, canEditIssuance, validateIssuanceData } from '../../supabase/functions/_shared/issuance-rules';

describe('Emissão por empresa e certificado Monest', () => {
  const monest = { id: 'monest', company_id: null, is_procurador: true, is_active: true, expires_at: null };
  it('permite certificado Monest para empresas diferentes', () => {
    expect(certificateCanIssue(monest, 'empresa-1')).toBe(true);
    expect(certificateCanIssue(monest, 'empresa-2')).toBe(true);
  });
  it('limita certificado do cliente à sua própria empresa', () => {
    expect(certificateCanIssue({ ...monest, is_procurador: false, company_id: 'empresa-1' }, 'empresa-2')).toBe(false);
  });
  it('recusa certificado vencido', () => {
    expect(certificateCanIssue({ ...monest, expires_at: '2026-11-04T00:00:00Z' }, 'empresa-1', Date.parse('2026-11-05T00:00:00Z'))).toBe(false);
  });
});

describe('Confirmação e resultado incerto', () => {
  const ready = { status: 'draft' as const, confirmed: true, certificateEligible: true, fiscalConfigured: true, integrationVerified: true };
  it('exige confirmação antes da emissão real', () => {
    expect(confirmationBlockers({ ...ready, confirmed: false })).toHaveLength(1);
    expect(confirmationBlockers(ready)).toHaveLength(0);
  });
  it('bloqueia emissão antes da validação oficial e da VPS', () => {
    expect(confirmationBlockers({ ...ready, integrationVerified: false })).toHaveLength(1);
  });
  it('não permite reenviar ou editar resultado incerto', () => {
    expect(canEditIssuance('uncertain')).toBe(false);
    expect(confirmationBlockers({ ...ready, status: 'uncertain' })).toHaveLength(1);
  });
  it('não permite reenviar nota autorizada ou na fila', () => {
    expect(confirmationBlockers({ ...ready, status: 'authorized' })).toHaveLength(1);
    expect(confirmationBlockers({ ...ready, status: 'queued' })).toHaveLength(1);
  });
  it('exige dados completos para confirmar, mas aceita rascunho vazio', () => {
    expect(validateIssuanceData({})).toEqual([]);
    expect(validateIssuanceData({}, true).length).toBeGreaterThan(0);
  });
});