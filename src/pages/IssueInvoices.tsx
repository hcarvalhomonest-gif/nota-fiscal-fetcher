import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { IssuanceFields } from '@/components/IssuanceFields';
import { IssuanceFiscalSettings } from '@/components/IssuanceFiscalSettings';
import { certificateLabel } from '@/lib/fiscal-rules';
import { certificateCanIssue, canEditIssuance, validateIssuanceData } from '../../supabase/functions/_shared/issuance-rules';
import { type FiscalSettings, type Issuance, type IssuanceData, type IssuingCompany, type IssuingCertificate, emptyIssuance, issuanceAction, statusLabels, money } from '@/lib/issuance';
import { ArrowLeft, FilePlus2, Save, Plus, Loader2, ShieldCheck, AlertTriangle, Settings2, Eye, Pencil, Trash2, RefreshCw } from 'lucide-react';

const IssueInvoices = () => {
  const [companies, setCompanies] = useState<IssuingCompany[]>([]);
  const [certificates, setCertificates] = useState<IssuingCertificate[]>([]);
  const [settings, setSettings] = useState<FiscalSettings[]>([]);
  const [items, setItems] = useState<Issuance[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ id: string; version: number } | null>(null);
  const [companyId, setCompanyId] = useState('');
  const [certificateId, setCertificateId] = useState('');
  const [data, setData] = useState<IssuanceData>({ ...emptyIssuance });
  const [busy, setBusy] = useState(false);
  const [fiscalOpen, setFiscalOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [viewItem, setViewItem] = useState<Issuance | null>(null);
  const [filter, setFilter] = useState('all');
  const [capabilities, setCapabilities] = useState<{ production_ready: boolean; blockers: string[] } | null>(null);
  const { toast } = useToast();
  const company = companies.find(c => c.id === companyId);
  const fiscal = settings.find(s => s.company_id === companyId);
  const availableCerts = certificates.filter(c => certificateCanIssue(c, companyId));
  const certificate = availableCerts.find(c => c.id === certificateId);
  const productionReady = capabilities?.production_ready === true;

  async function load() {
    setLoading(true); setLoadError('');
    try {
      const [c, k, s, i, cap] = await Promise.all([
        supabase.from('companies').select('id,cnpj,legal_name,trade_name').order('legal_name'),
        supabase.from('certificates').select('id,company_id,is_procurador,is_active,expires_at,subject_name,storage_path').eq('is_active', true).order('created_at', { ascending: false }),
        supabase.from('issuance_settings').select('*'),
        supabase.from('nfse_issuances').select('*').order('created_at', { ascending: false }),
        issuanceAction<{ production_ready: boolean; blockers: string[] }>({ action: 'capabilities' }),
      ]);
      for (const result of [c, k, s, i]) if (result.error) throw result.error;
      setCompanies(c.data ?? []); setCertificates(k.data ?? []); setSettings(s.data ?? []); setItems(i.data ?? []); setCapabilities(cap);
    } catch { setLoadError('Não foi possível carregar a área de emissão. Tente novamente.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  function chooseCompany(id: string) {
    setCompanyId(id);
    const available = certificates.filter(c => certificateCanIssue(c, id));
    setCertificateId((available.find(c => c.is_procurador) ?? available[0])?.id ?? '');
    setData(current => ({ ...current, service_municipality: settings.find(s => s.company_id === id)?.municipality_code ?? '' }));
  }
  function newDraft() {
    setDraft(null); setData({ ...emptyIssuance }); setCompanyId(''); setCertificateId(''); setEditing(true); setConfirmed(false);
  }
  function edit(item: Issuance) {
    setDraft({ id: item.id, version: item.version }); setCompanyId(item.company_id); setCertificateId(item.certificate_id ?? '');
    setData({ ...emptyIssuance, ...(typeof item.payload === 'object' && !Array.isArray(item.payload) ? item.payload : {}) } as IssuanceData);
    setEditing(true); setConfirmed(false);
  }
  async function save() {
    if (!companyId) { toast({ title: 'Escolha a empresa emitente', variant: 'destructive' }); return null; }
    const issues = validateIssuanceData(data);
    if (issues.length) { toast({ title: 'Confira os dados', description: issues.join(' '), variant: 'destructive' }); return null; }
    setBusy(true);
    try {
      const result = await issuanceAction({ action: 'save_draft', company_id: companyId, certificate_id: certificateId || null, payload: data, ...(draft ? { id: draft.id, version: draft.version } : {}) });
      if (!result.draft) throw new Error('Rascunho não salvo.');
      setDraft(result.draft); toast({ title: 'Rascunho salvo', description: 'Nenhuma nota foi emitida.' }); void load(); return result.draft;
    } catch (e) { toast({ title: 'Não foi possível salvar', description: e instanceof Error ? e.message : '', variant: 'destructive' }); return null; }
    finally { setBusy(false); }
  }
  async function review() {
    const issues = validateIssuanceData(data, true);
    if (issues.length || !certificate || !fiscal) {
      toast({ title: 'Complete os dados antes de revisar', description: [...issues, ...(!certificate ? ['Escolha um certificado válido.'] : []), ...(!fiscal ? ['Salve a configuração fiscal da empresa.'] : [])].join(' '), variant: 'destructive' }); return;
    }
    if (await save()) { setConfirmed(false); setReviewOpen(true); }
  }
  async function confirmIssuance() {
    if (!draft || !confirmed || !productionReady) return;
    setBusy(true);
    try { await issuanceAction({ action: 'confirm', id: draft.id, version: draft.version, confirmed: true }); setReviewOpen(false); setEditing(false); await load(); }
    catch (e) { toast({ title: 'Emissão não enviada', description: e instanceof Error ? e.message : '', variant: 'destructive' }); }
    finally { setBusy(false); }
  }
  async function remove(item: Issuance) {
    if (!window.confirm('Excluir este rascunho? Nenhuma nota fiscal será cancelada.')) return;
    try { await issuanceAction({ action: 'delete_draft', id: item.id }); await load(); }
    catch (e) { toast({ title: 'Não foi possível excluir', description: e instanceof Error ? e.message : '', variant: 'destructive' }); }
  }
  const filtered = items.filter(i => filter === 'all' || (filter === 'draft' ? i.status === 'draft' : i.status !== 'draft'));
  return <div className="space-y-6 min-w-0">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="font-display text-3xl font-bold">Emitir NFS-e</h1><p className="text-muted-foreground mt-1">Emissor Nacional · Monest</p></div>
      {editing ? <Button variant="outline" onClick={() => { setEditing(false); void load(); }}><ArrowLeft className="mr-2 h-4 w-4" />Histórico</Button> : <Button onClick={newDraft} disabled={loading || !!loadError}><Plus className="mr-2 h-4 w-4" />Nova nota</Button>}
    </header>
    {!productionReady && <div className="border-l-2 border-warning bg-warning/10 px-4 py-3 flex gap-3 rounded-r-md"><ShieldCheck className="h-5 w-5 text-warning shrink-0 mt-0.5" /><div><p className="font-semibold text-warning">Emissão real aguardando liberação</p><p className="text-sm text-muted-foreground mt-1">Validação da assinatura oficial, atualização da VPS e autorização de emissão por empresa pendentes. Nenhuma nota será enviada enquanto houver pendências.</p></div></div>}
    {loadError ? <div className="border border-destructive/40 p-5 rounded-md space-y-3"><p>{loadError}</p><Button variant="outline" onClick={load}><RefreshCw className="mr-2 h-4 w-4" />Tentar novamente</Button></div> : loading && !editing ? <div className="py-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Carregando emissões" /></div> : editing ? <>
      <section className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-display text-xl font-semibold">{draft ? 'Editar rascunho' : 'Nova nota'}</h2><Badge variant="outline">Rascunho · sem validade fiscal</Badge></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Empresa emitente</Label><Select value={companyId} onValueChange={chooseCompany} disabled={!!draft}><SelectTrigger><SelectValue placeholder="Selecione a empresa" /></SelectTrigger><SelectContent>{companies.map(c => <SelectItem key={c.id} value={c.id}>{c.trade_name || c.legal_name} · {c.cnpj}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label>Certificado para emissão</Label><Select value={certificateId} onValueChange={setCertificateId} disabled={!companyId || !availableCerts.length}><SelectTrigger><SelectValue placeholder={companyId ? 'Selecione o certificado' : 'Escolha a empresa antes'} /></SelectTrigger><SelectContent>{availableCerts.map(c => <SelectItem key={c.id} value={c.id}>{certificateLabel(c)}{c.is_procurador ? ' · Procurador' : ' · Cliente'}</SelectItem>)}</SelectContent></Select></div>
        </div>
        {company && <div className="border-l-2 border-primary pl-4 space-y-1 text-sm"><p className="font-semibold">Empresa representada: {company.legal_name}</p><p className="text-muted-foreground">CNPJ {company.cnpj}</p><p className="text-primary">Certificado: {certificate ? certificateLabel(certificate) : 'Nenhum certificado válido disponível'}</p></div>}
        {company && <div className="flex flex-wrap items-center justify-between gap-3 border-y py-4"><div><p className="font-medium">Configuração fiscal</p><p className="text-sm text-muted-foreground">{fiscal ? `${fiscal.tax_regime === 'mei' ? 'MEI' : fiscal.tax_regime === 'simples' ? 'Simples Nacional' : 'Lucro presumido / real'} · Município ${fiscal.municipality_code} · Série ${fiscal.dps_series}` : 'Pendente para esta empresa'}</p></div><Button variant="outline" onClick={() => setFiscalOpen(true)}><Settings2 className="mr-2 h-4 w-4" />{fiscal ? 'Editar configuração' : 'Configurar empresa'}</Button></div>}
        {companies.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma empresa cadastrada. <Link to="/app/empresas" className="text-primary underline">Cadastrar empresa</Link></p>}
        <IssuanceFields value={data} onChange={setData} />
      </section>
      <div className="flex flex-wrap justify-end gap-3 border-t pt-5"><Button variant="outline" onClick={save} disabled={busy || !companyId}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Salvar rascunho</Button><Button onClick={review} disabled={busy || !companyId}><Eye className="mr-2 h-4 w-4" />Revisar nota</Button></div>
    </> : <>
      <div className="flex flex-wrap items-center justify-between gap-3"><Tabs value={filter} onValueChange={setFilter}><TabsList><TabsTrigger value="all">Todas</TabsTrigger><TabsTrigger value="draft">Rascunhos</TabsTrigger><TabsTrigger value="issued">Emissões</TabsTrigger></TabsList></Tabs><span className="text-sm text-muted-foreground">{filtered.length} {filtered.length === 1 ? 'solicitação' : 'solicitações'}</span></div>
      {!filtered.length ? <div className="border-y py-16 text-center"><FilePlus2 className="h-10 w-10 text-primary mx-auto mb-4" /><h2 className="font-display text-xl font-semibold">{filter === 'draft' ? 'Nenhum rascunho' : filter === 'issued' ? 'Nenhuma emissão' : 'Nenhuma nota preparada'}</h2><p className="text-muted-foreground text-sm mt-2">{filter === 'issued' ? 'Notas autorizadas aparecerão aqui após a liberação da emissão.' : 'Os rascunhos desta conta aparecerão aqui.'}</p></div> : <div className="divide-y border-y">{filtered.map(item => {
        const payload = item.payload as Partial<IssuanceData> | null;
        const c = companies.find(c => c.id === item.company_id);
        return <div key={item.id} className="py-5 flex flex-wrap items-center justify-between gap-4"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold break-words">{c?.trade_name || c?.legal_name || 'Empresa indisponível'}</h3><Badge variant={item.status === 'rejected' ? 'destructive' : item.status === 'authorized' ? 'default' : 'outline'}>{statusLabels[item.status] ?? item.status}</Badge></div><p className="text-sm text-muted-foreground mt-1 break-words">{payload?.customer_name || 'Tomador não informado'} · {payload?.competence ? payload.competence.split('-').reverse().join('/') : 'Competência pendente'}</p><p className="text-sm mt-1">{money(payload?.amount ?? 0)}{item.invoice_number ? ` · Nota ${item.invoice_number}` : ''}</p>{item.error_message && <p className="text-sm text-destructive mt-1 break-words">{item.error_message}</p>}</div><div className="flex gap-1">{canEditIssuance(item.status) ? <Button variant="outline" size="sm" onClick={() => edit(item)}><Pencil className="h-4 w-4 mr-2" />Editar</Button> : <Button variant="outline" size="sm" onClick={() => setViewItem(item)}><Eye className="h-4 w-4 mr-2" />Ver detalhes</Button>}{item.status === 'draft' && <Button variant="ghost" size="icon" aria-label="Excluir rascunho" title="Excluir rascunho" onClick={() => remove(item)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}</div></div>;
      })}</div>}
    </>}
    <Dialog open={fiscalOpen} onOpenChange={setFiscalOpen}><DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>Configuração fiscal · {company?.trade_name || company?.legal_name}</DialogTitle><DialogDescription>Dados do prestador para emissão nacional.</DialogDescription></DialogHeader>{companyId && <IssuanceFiscalSettings key={`${companyId}-${fiscal?.updated_at ?? 'new'}`} companyId={companyId} initial={fiscal} onSaved={() => { setFiscalOpen(false); void load(); }} />}</DialogContent></Dialog>
    <Dialog open={reviewOpen} onOpenChange={setReviewOpen}><DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>Revisão da NFS-e</DialogTitle><DialogDescription>Confira os dados antes de confirmar uma emissão com validade fiscal.</DialogDescription></DialogHeader><dl className="grid gap-4 sm:grid-cols-2 text-sm">{[['Emitente',company?.legal_name],['CNPJ emitente',company?.cnpj],['Certificado',certificate ? certificateLabel(certificate) : ''],['Competência',data.competence.split('-').reverse().join('/')],['Tomador',data.customer_name],['CPF / CNPJ tomador',data.customer_document],['Município do tomador',data.customer_municipality || 'Não informado'],['Endereço do tomador',`${data.customer_street} ${data.customer_number} ${data.customer_district}`.trim() || 'Não informado'],['E-mail',data.customer_email || 'Não informado'],['CEP',data.customer_postal_code || 'Não informado'],['Local de prestação',data.service_municipality],['Código nacional',data.national_service_code],['Código municipal',data.municipal_service_code || 'Não informado'],['NBS',data.nbs_code || 'Não informado'],['Valor do serviço',money(data.amount)],['Alíquota ISS',data.iss_rate === null ? 'Não informada' : `${data.iss_rate}%`],['Tributação ISS',({'1':'Tributável','2':'Imunidade','3':'Exportação','4':'Não incidência'} as Record<string,string>)[data.iss_taxation]],['Retenção ISS',({'1':'Não retido','2':'Pelo tomador','3':'Pelo intermediário'} as Record<string,string>)[data.iss_retention]] .map(([label,value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-medium break-words">{value}</dd></div>)}</dl><div className="border-t pt-4 text-sm"><p className="text-muted-foreground">Descrição do serviço</p><p className="whitespace-pre-wrap break-words mt-1">{data.description}</p></div>{!productionReady && <div className="bg-warning/10 border border-warning/30 rounded-md p-3 text-sm"><p className="font-semibold text-warning flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />Emissão bloqueada</p><ul className="list-disc pl-5 mt-2 space-y-1">{(capabilities?.blockers ?? ['Liberação da integração oficial pendente.']).map(b => <li key={b}>{b}</li>)}</ul></div>}<label className="flex gap-3 items-start text-sm"><Checkbox checked={confirmed} onCheckedChange={v => setConfirmed(v === true)} disabled={!productionReady} /><span>Conferi os dados e autorizo a emissão desta nota com validade fiscal.</span></label><Button disabled={!productionReady || !confirmed || busy} onClick={confirmIssuance}><ShieldCheck className="mr-2 h-4 w-4" />Confirmar emissão real</Button></DialogContent></Dialog>
    <Dialog open={!!viewItem} onOpenChange={open => { if (!open) setViewItem(null); }}><DialogContent><DialogHeader><DialogTitle>Detalhes da emissão</DialogTitle><DialogDescription>{viewItem ? statusLabels[viewItem.status] : ''}</DialogDescription></DialogHeader><p className="text-sm break-all">Chave de acesso: {viewItem?.access_key || 'Ainda não confirmada'}</p><p className="text-sm break-all">DPS: {viewItem?.dps_id || 'Não enviada'}</p>{viewItem?.error_message && <p className="text-destructive text-sm">{viewItem.error_message}</p>}{viewItem?.status === 'uncertain' && <p className="text-warning text-sm">Não reenvie esta nota. É necessário consultar o resultado oficial para evitar duplicidade.</p>}</DialogContent></Dialog>
  </div>;
};
export default IssueInvoices;