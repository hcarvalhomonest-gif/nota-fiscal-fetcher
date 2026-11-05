import type { Database } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';

export type Issuance = Database['public']['Tables']['nfse_issuances']['Row'];
export type FiscalSettings = Database['public']['Tables']['issuance_settings']['Row'];
export type IssuingCompany = { id: string; cnpj: string; legal_name: string; trade_name: string | null };
export type IssuingCertificate = { id: string; company_id: string | null; is_procurador: boolean; is_active: boolean; expires_at: string | null; subject_name: string | null; storage_path: string };
export type IssuanceData = {
  competence: string; customer_document: string; customer_name: string; customer_email: string;
  customer_municipality: string; customer_postal_code: string; customer_street: string;
  customer_number: string; customer_district: string; service_municipality: string;
  national_service_code: string; municipal_service_code: string; nbs_code: string;
  description: string; amount: number; iss_rate: number | null; iss_taxation: '1' | '2' | '3' | '4'; iss_retention: '1' | '2' | '3';
};
export const emptyIssuance: IssuanceData = {
  competence: '', customer_document: '', customer_name: '', customer_email: '', customer_municipality: '',
  customer_postal_code: '', customer_street: '', customer_number: '', customer_district: '',
  service_municipality: '', national_service_code: '', municipal_service_code: '', nbs_code: '',
  description: '', amount: 0, iss_rate: null, iss_taxation: '1', iss_retention: '1',
};
export const statusLabels: Record<string, string> = {
  draft: 'Rascunho', queued: 'Na fila', processing: 'Em processamento', authorized: 'Autorizada',
  rejected: 'Rejeitada', uncertain: 'Resultado a confirmar',
};
export const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export async function issuanceAction<T = { success: boolean; draft?: { id: string; version: number } }>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('issuance-workspace', { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context instanceof Response) {
      const details = await context.json().catch(() => null);
      throw new Error(details?.error || 'Não foi possível concluir a solicitação.');
    }
    throw new Error('Não foi possível acessar o serviço de emissão.');
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}