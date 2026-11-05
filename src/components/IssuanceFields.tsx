import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type IssuanceData, money } from '@/lib/issuance';

export function IssuanceFields({ value, onChange }: { value: IssuanceData; onChange: (value: IssuanceData) => void }) {
  const update = (key: keyof IssuanceData, next: string | number | null) => onChange({ ...value, [key]: next });
  const field = (key: keyof IssuanceData, label: string, options: { maxLength?: number; type?: string; required?: boolean } = {}) => (
    <div className="space-y-1.5 min-w-0">
      <Label htmlFor={`issuance-${key}`}>{label}</Label>
      <Input id={`issuance-${key}`} value={String(value[key] ?? '')} onChange={e => update(key, e.target.value)} {...options} />
    </div>
  );
  return (
    <div className="space-y-7">
      <section className="space-y-4 border-t pt-5">
        <h2 className="font-display text-lg font-semibold">Tomador do serviço</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {field('customer_document', 'CPF / CNPJ', { maxLength: 18 })}
          {field('customer_name', 'Nome / razão social', { maxLength: 200 })}
          {field('customer_email', 'E-mail', { type: 'email' })}
          {field('customer_municipality', 'Código IBGE do município do tomador', { maxLength: 7 })}
          {field('customer_postal_code', 'CEP (somente números)', { maxLength: 8 })}
          {field('customer_street', 'Logradouro', { maxLength: 200 })}
          {field('customer_number', 'Número', { maxLength: 60 })}
          {field('customer_district', 'Bairro', { maxLength: 60 })}
        </div>
      </section>
      <section className="space-y-4 border-t pt-5">
        <h2 className="font-display text-lg font-semibold">Serviço e competência</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {field('competence', 'Competência', { type: 'date' })}
          {field('service_municipality', 'Código IBGE do local da prestação', { maxLength: 7 })}
          {field('national_service_code', 'Código de tributação nacional', { maxLength: 6 })}
          {field('municipal_service_code', 'Código de tributação municipal', { maxLength: 20 })}
          {field('nbs_code', 'Código NBS', { maxLength: 9 })}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="issuance-description">Descrição do serviço</Label>
          <Textarea id="issuance-description" value={value.description} onChange={e => update('description', e.target.value)} maxLength={2000} rows={4} />
        </div>
      </section>
      <section className="space-y-4 border-t pt-5">
        <h2 className="font-display text-lg font-semibold">Valores e ISS</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="issuance-amount">Valor do serviço (R$)</Label><Input id="issuance-amount" type="number" min="0" step="0.01" value={value.amount || ''} onChange={e => update('amount', Number(e.target.value))} /></div>
          <div className="space-y-1.5"><Label htmlFor="issuance-rate">Alíquota de ISS (%)</Label><Input id="issuance-rate" type="number" min="0" max="100" step="0.01" value={value.iss_rate ?? ''} onChange={e => update('iss_rate', e.target.value === '' ? null : Number(e.target.value))} /></div>
          <div className="space-y-1.5"><Label>Tributação de ISS</Label><Select value={value.iss_taxation} onValueChange={v => update('iss_taxation', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">Operação tributável</SelectItem><SelectItem value="2">Imunidade</SelectItem><SelectItem value="3">Exportação de serviço</SelectItem><SelectItem value="4">Não incidência</SelectItem></SelectContent></Select></div>
          <div className="space-y-1.5"><Label>Retenção de ISS</Label><Select value={value.iss_retention} onValueChange={v => update('iss_retention', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">Não retido</SelectItem><SelectItem value="2">Retido pelo tomador</SelectItem><SelectItem value="3">Retido pelo intermediário</SelectItem></SelectContent></Select></div>
        </div>
        <div className="flex items-center justify-between border-t pt-4 gap-3"><span className="text-muted-foreground">Valor do serviço</span><strong className="font-display text-2xl text-primary">{money(value.amount)}</strong></div>
      </section>
    </div>
  );
}