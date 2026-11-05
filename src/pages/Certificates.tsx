import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, KeyRound, Loader2, ShieldCheck, Pencil } from "lucide-react";

type Cert = {
  id: string; storage_path: string; subject_name: string | null;
  expires_at: string | null; is_active: boolean; company_id: string | null;
  is_procurador: boolean; represented_company_ids: string[];
};
type Company = { id: string; cnpj: string; legal_name: string; trade_name: string | null };

const fileToBase64 = (file: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res((r.result as string).split(",")[1] ?? "");
  r.onerror = rej;
  r.readAsDataURL(file);
});

const CompanyPicker = ({ companies, value, onChange }: {
  companies: Company[]; value: string[]; onChange: (v: string[]) => void;
}) => {
  const [q, setQ] = useState("");
  const list = companies.filter((c) =>
    `${c.legal_name} ${c.trade_name ?? ""} ${c.cnpj}`.toLowerCase().includes(q.toLowerCase()));
  const all = list.length > 0 && list.every((c) => value.includes(c.id));
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input placeholder="Buscar por nome ou CNPJ…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="button" variant="outline" onClick={() =>
          onChange(all ? value.filter((id) => !list.some((c) => c.id === id))
            : Array.from(new Set([...value, ...list.map((c) => c.id)])))}>
          {all ? "Desmarcar" : "Marcar todas"}
        </Button>
      </div>
      <div className="max-h-56 overflow-auto rounded-md border border-border divide-y divide-border">
        {list.length === 0 && <div className="p-3 text-sm text-muted-foreground">Nenhuma empresa cadastrada.</div>}
        {list.map((c) => (
          <label key={c.id} className="flex items-center gap-3 p-2.5 text-sm cursor-pointer hover:bg-muted/50">
            <Checkbox checked={value.includes(c.id)} onCheckedChange={(ch) =>
              onChange(ch ? [...value, c.id] : value.filter((x) => x !== c.id))} />
            <span className="flex-1">{c.trade_name || c.legal_name}</span>
            <span className="text-muted-foreground font-mono text-xs">{c.cnpj}</span>
          </label>
        ))}
      </div>
      <div className="text-xs text-muted-foreground">{value.length} empresa(s) selecionada(s)</div>
    </div>
  );
};

const Certificates = () => {
  const [certs, setCerts] = useState<Cert[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [mode, setMode] = useState<null | "procurador" | "cliente">(null);
  const [loading, setLoading] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [represented, setRepresented] = useState<string[]>([]);
  const [editing, setEditing] = useState<Cert | null>(null);
  const { toast } = useToast();

  const load = async () => {
    const [cs, cos] = await Promise.all([
      supabase.from("certificates").select("*").order("created_at", { ascending: false }),
      supabase.from("companies").select("id, cnpj, legal_name, trade_name").order("legal_name"),
    ]);
    setCerts((cs.data ?? []) as Cert[]);
    setCompanies(cos.data ?? []);
  };
  useEffect(() => { load(); }, []);

  const openUpload = (m: "procurador" | "cliente") => {
    setCompanyId(""); setRepresented([]); setMode(m);
  };

  const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const file = fd.get("file") as File | null;
    const password = (fd.get("password") as string) ?? "";
    const subject = (fd.get("subject") as string) ?? "";
    const expires = (fd.get("expires_at") as string) ?? "";
    const isProc = mode === "procurador";

    if (isProc && represented.length === 0) { toast({ title: "Escolha ao menos uma empresa representada", variant: "destructive" }); return; }
    if (!isProc && !companyId) { toast({ title: "Selecione a empresa", variant: "destructive" }); return; }
    if (!file || file.size === 0) { toast({ title: "Selecione o arquivo .pfx", variant: "destructive" }); return; }
    if (file.size > 5 * 1024 * 1024) { toast({ title: "Arquivo muito grande (>5MB)", variant: "destructive" }); return; }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("upload-certificate", {
        body: {
          company_id: isProc ? null : companyId,
          is_procurador: isProc,
          represented_company_ids: isProc ? represented : [],
          password,
          file_base64: await fileToBase64(file),
          file_name: file.name,
          subject_name: subject || (isProc ? "Monest" : null),
          expires_at: expires ? new Date(expires).toISOString() : null,
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast({ title: "Certificado salvo", description: "Senha criptografada com sucesso." });
      setMode(null);
      load();
    } catch (err) {
      toast({ title: "Erro", description: err instanceof Error ? err.message : "Falha", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const saveRepresented = async () => {
    if (!editing) return;
    const { error } = await supabase.from("certificates")
      .update({ represented_company_ids: represented }).eq("id", editing.id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Empresas atualizadas" });
    setEditing(null); load();
  };

  const handleDelete = async (cert: Cert) => {
    if (!confirm("Remover este certificado?")) return;
    await supabase.storage.from("certificates").remove([cert.storage_path]);
    const { error } = await supabase.from("certificates").delete().eq("id", cert.id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    load();
  };

  const companyOf = (id: string | null) => companies.find((c) => c.id === id);
  const procs = certs.filter((c) => c.is_procurador);
  const clients = certs.filter((c) => !c.is_procurador);
  const fmtVal = (c: Cert) => c.expires_at ? ` · vence em ${new Date(c.expires_at).toLocaleDateString("pt-BR")}` : "";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold mb-1">Certificados</h1>
        <p className="text-muted-foreground">O certificado da Monest acessa o portal como procurador das empresas escolhidas. O certificado do cliente é opcional e serve de reserva.</p>
      </div>

      {/* Monest procurador */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Certificado Monest (procurador)
          </h2>
          <Button onClick={() => openUpload("procurador")}><Plus className="h-4 w-4 mr-2" /> Enviar certificado Monest</Button>
        </div>
        {procs.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">Nenhum certificado da Monest enviado ainda.</Card>
        ) : procs.map((c) => {
          const expired = c.expires_at && new Date(c.expires_at) < new Date();
          const reps = c.represented_company_ids.map(companyOf).filter(Boolean) as Company[];
          return (
            <Card key={c.id} className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-display font-semibold flex items-center gap-2">
                    {c.subject_name || "Monest"} <Badge>Procurador</Badge>
                    {expired && <Badge variant="destructive">Expirado</Badge>}
                  </div>
                  <div className="text-sm text-muted-foreground">{c.storage_path.split("/").pop()}{fmtVal(c)}</div>
                </div>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={() => { setRepresented(c.represented_company_ids); setEditing(c); }}>
                    <Pencil className="h-4 w-4 mr-2" /> Empresas
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(c)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {reps.length === 0 ? <span className="text-sm text-warning">Nenhuma empresa vinculada</span>
                  : reps.map((r) => <Badge key={r.id} variant="secondary">{r.trade_name || r.legal_name} · {r.cnpj}</Badge>)}
              </div>
            </Card>
          );
        })}
      </section>

      {/* Clientes */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-accent" /> Certificados dos clientes (reserva)
          </h2>
          <Button variant="outline" disabled={companies.length === 0} onClick={() => openUpload("cliente")}>
            <Plus className="h-4 w-4 mr-2" /> Certificado de cliente
          </Button>
        </div>
        {clients.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">Nenhum certificado de cliente. É opcional.</Card>
        ) : clients.map((c) => {
          const co = companyOf(c.company_id);
          const expired = c.expires_at && new Date(c.expires_at) < new Date();
          return (
            <Card key={c.id} className="p-4 flex items-center justify-between">
              <div>
                <div className="font-display font-semibold flex items-center gap-2">
                  {co ? (co.trade_name || co.legal_name) : "—"}
                  {expired && <Badge variant="destructive">Expirado</Badge>}
                </div>
                <div className="text-sm text-muted-foreground">{c.subject_name || c.storage_path.split("/").pop()}{fmtVal(c)}</div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => handleDelete(c)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </Card>
          );
        })}
      </section>

      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{mode === "procurador" ? "Certificado Monest (procurador)" : "Certificado do cliente"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpload} className="space-y-3">
            {mode === "procurador" ? (
              <div>
                <Label>Empresas que a Monest representa</Label>
                <CompanyPicker companies={companies} value={represented} onChange={setRepresented} />
              </div>
            ) : (
              <div>
                <Label>Empresa</Label>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.trade_name || c.legal_name} · {c.cnpj}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div><Label>Arquivo .pfx / .p12</Label><Input name="file" type="file" accept=".pfx,.p12" required /></div>
            <div><Label>Senha do certificado</Label><Input name="password" type="password" required /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Titular (opcional)</Label><Input name="subject" /></div>
              <div><Label>Validade (opcional)</Label><Input name="expires_at" type="date" /></div>
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Enviar
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Empresas representadas pela Monest</DialogTitle></DialogHeader>
          <CompanyPicker companies={companies} value={represented} onChange={setRepresented} />
          <Button onClick={saveRepresented} className="w-full">Salvar</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Certificates;
