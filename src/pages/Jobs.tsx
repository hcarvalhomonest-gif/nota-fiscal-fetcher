import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, FileDown, Loader2, Trash2 } from "lucide-react";

type Job = {
  id: string; status: string; period_start: string; period_end: string;
  total_invoices: number; downloaded_invoices: number; error_message: string | null;
  company_id: string; created_at: string;
};
type Company = { id: string; legal_name: string; trade_name: string | null };
type Cert = { id: string; company_id: string; is_active: boolean; subject_name: string | null };

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline", processing: "secondary", completed: "default",
  failed: "destructive", cancelled: "outline",
};
const statusLabel: Record<string, string> = {
  pending: "Na fila", processing: "Processando", completed: "Concluído",
  failed: "Falhou", cancelled: "Cancelado",
};

const Jobs = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [certs, setCerts] = useState<Cert[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [certId, setCertId] = useState("");
  const { toast } = useToast();

  const load = async () => {
    const [j, c, k] = await Promise.all([
      supabase.from("download_jobs").select("*").order("created_at", { ascending: false }),
      supabase.from("companies").select("id, legal_name, trade_name"),
      supabase.from("certificates").select("id, company_id, is_active, subject_name").eq("is_active", true),
    ]);
    setJobs(j.data ?? []);
    setCompanies(c.data ?? []);
    setCerts(k.data ?? []);
  };
  useEffect(() => {
    load();
    const ch = supabase.channel("jobs-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "download_jobs" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const certsForCompany = certs.filter((c) => c.company_id === companyId);
  const companyOf = (id: string) => companies.find((c) => c.id === id);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const period_start = fd.get("period_start") as string;
    const period_end = fd.get("period_end") as string;
    if (!companyId || !certId || !period_start || !period_end) {
      toast({ title: "Preencha todos os campos", variant: "destructive" });
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("create-job", {
      body: { company_id: companyId, certificate_id: certId, period_start, period_end },
    });
    setLoading(false);
    if (error || (data as { error?: string })?.error) {
      toast({ title: "Erro", description: error?.message ?? (data as { error: string }).error, variant: "destructive" });
      return;
    }
    toast({ title: "Job criado", description: "Aguardando o worker." });
    setOpen(false);
    setCompanyId(""); setCertId("");
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir este job e todas as notas baixadas dele?")) return;
    const { error } = await supabase.from("download_jobs").delete().eq("id", id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold mb-1">Downloads</h1>
          <p className="text-muted-foreground">Cada job baixa todas as NFS-e emitidas no período.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button disabled={certs.length === 0}><Plus className="h-4 w-4 mr-2" /> Novo download</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo job de download</DialogTitle></DialogHeader>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <Label>Empresa</Label>
                <Select value={companyId} onValueChange={(v) => { setCompanyId(v); setCertId(""); }}>
                  <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.trade_name || c.legal_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Certificado</Label>
                <Select value={certId} onValueChange={setCertId} disabled={!companyId}>
                  <SelectTrigger><SelectValue placeholder={companyId ? "Selecione…" : "Escolha uma empresa antes"} /></SelectTrigger>
                  <SelectContent>
                    {certsForCompany.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.subject_name || c.id.slice(0, 8)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>De</Label><Input name="period_start" type="date" required /></div>
                <div><Label>Até</Label><Input name="period_end" type="date" required /></div>
              </div>
              <Button type="submit" disabled={loading} className="w-full">
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Criar job
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {certs.length === 0 && (
        <Card className="p-4 bg-warning/10 border-warning/30 text-sm">
          Cadastre uma empresa e um certificado A1 ativo para poder iniciar downloads.
        </Card>
      )}

      {jobs.length === 0 ? (
        <Card className="p-12 text-center">
          <FileDown className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">Nenhum download criado.</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {jobs.map((j) => {
            const co = companyOf(j.company_id);
            const pct = j.total_invoices > 0 ? Math.round((j.downloaded_invoices / j.total_invoices) * 100) : 0;
            return (
              <Card key={j.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-display font-semibold">{co ? (co.trade_name || co.legal_name) : "—"}</span>
                      <Badge variant={statusVariant[j.status]}>{statusLabel[j.status]}</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Período: {new Date(j.period_start).toLocaleDateString("pt-BR")} → {new Date(j.period_end).toLocaleDateString("pt-BR")}
                    </div>
                    {(j.status === "processing" || j.status === "completed") && (
                      <div className="mt-2 text-sm">
                        {j.downloaded_invoices} / {j.total_invoices || "?"} notas {j.total_invoices > 0 && `(${pct}%)`}
                      </div>
                    )}
                    {j.error_message && (
                      <div className="mt-2 text-sm text-destructive">{j.error_message}</div>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(j.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Jobs;
