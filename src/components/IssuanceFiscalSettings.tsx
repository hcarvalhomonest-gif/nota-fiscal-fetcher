import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type FiscalSettings, issuanceAction } from '@/lib/issuance';
import { useToast } from '@/hooks/use-toast';
import { Save, Loader2 } from 'lucide-react';

export function IssuanceFiscalSettings({ companyId, initial, onSaved }: { companyId: string; initial?: FiscalSettings; onSaved: () => void }) {
  const [municipality, setMunicipality] = useState(initial?.municipality_code ?? '');
  const [registration, setRegistration] = useState(initial?.municipal_registration ?? '');
  const [regime, setRegime] = useState(initial?.tax_regime ?? '');
  const [special, setSpecial] = useState(initial?.special_tax_regime ?? '0');
  const [assessment, setAssessment] = useState(initial?.simples_assessment ?? '');
  const [series, setSeries] = useState(initial?.dps_series ?? '1');
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      await issuanceAction({ action: 'save_settings', company_id: companyId, settings: { municipality_code: municipality, municipal_registration: registration || null, tax_regime: regime, special_tax_regime: special, simples_assessment: regime === 'simples' ? assessment || null : null, dps_series: series } });
      toast({ title: 'Configuração fiscal salva' }); onSaved();
    } catch (e) { toast({ title: 'Não foi possível salvar', description: e instanceof Error ? e.message : '', variant: 'destructive' }); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5"><Label htmlFor="fiscal-ibge">Código IBGE do município emitente</Label><Input id="fiscal-ibge" value={municipality} onChange={e => setMunicipality(e.target.value)} pattern="[0-9]{7}" maxLength={7} required /></div>
      <div className="space-y-1.5"><Label htmlFor="fiscal-im">Inscrição municipal</Label><Input id="fiscal-im" value={registration} onChange={e => setRegistration(e.target.value)} maxLength={20} /></div>
      <div className="space-y-1.5"><Label>Regime tributário</Label><Select value={regime} onValueChange={setRegime}><SelectTrigger><SelectValue placeholder="Selecione o regime" /></SelectTrigger><SelectContent><SelectItem value="mei">MEI</SelectItem><SelectItem value="simples">Simples Nacional</SelectItem><SelectItem value="normal">Lucro presumido / real</SelectItem></SelectContent></Select></div>
      <div className="space-y-1.5"><Label htmlFor="fiscal-series">Série da DPS</Label><Input id="fiscal-series" value={series} onChange={e => setSeries(e.target.value)} pattern="[0-9]{1,5}" maxLength={5} required /></div>
      <div className="space-y-1.5"><Label>Regime especial de tributação</Label><Select value={special} onValueChange={setSpecial}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">Nenhum</SelectItem><SelectItem value="1">Ato cooperado</SelectItem><SelectItem value="2">Estimativa</SelectItem><SelectItem value="3">Microempresa municipal</SelectItem><SelectItem value="4">Notário ou registrador</SelectItem><SelectItem value="5">Profissional autônomo</SelectItem><SelectItem value="6">Sociedade de profissionais</SelectItem><SelectItem value="9">Outros</SelectItem></SelectContent></Select></div>
      {regime === 'simples' && <div className="space-y-1.5"><Label>Apuração no Simples Nacional</Label><Select value={assessment} onValueChange={setAssessment}><SelectTrigger><SelectValue placeholder="Selecione a apuração" /></SelectTrigger><SelectContent><SelectItem value="1">Federais e ISS pelo Simples</SelectItem><SelectItem value="2">Federais pelo Simples, ISS fora</SelectItem><SelectItem value="3">Federais e ISS fora do Simples</SelectItem></SelectContent></Select></div>}
    </div>
    <Button type="submit" disabled={busy || !regime}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Salvar configuração fiscal</Button>
  </form>;
}