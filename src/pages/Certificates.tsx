import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, KeyRound, Loader2 } from "lucide-react";

type Cert = {
  id: string; storage_path: string; subject_name: string | null;
  expires_at: string | null; is_active: boolean; company_id: string;
};
type Company = { id: string; cnpj: string; legal_name: string; trade_name: string | null };

const Certificates = () => {
  const [certs, setCerts] = useState<Cert[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [companyId, setCompanyId] = useState<string>("");
  const { toast } = useToast();

  const load = async () => {
    const [cs, cos] = await Promise.all([
      supabase.from("certificates").select("*").order("created_at", { ascending: false }),
      supabase.from("companies").select("id, cnpj, legal_name, trade_name").order("legal_name"),
    ]);
    setCerts(cs.data ?? []);
    setCompanies(cos.data ?? []);
  };
  useEffect(() => { load(); }, []);

  const fileToBase64 = (file: File) => new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const s = (r.result as string).split(",")[1] ?? "";
      res(s);
    };
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const file = fd.get("file") as File | null;
    const password = (fd.get("password") as string) ?? "";
    const subject = (fd.get("subject") as string) ?? "";
    const expires = (fd.get("expires_at") as string) ?? "";

    if (!companyId) { toast({ title: "Selecione a empresa", variant: "destructive" }); return; }
    if (!file || file.size === 0) { toast({ title: "Selecione o arquivo .pfx", variant: "destructive" }); return; }
    if (file.size > 5 * 1024 * 1024) { toast({ title: "Arquivo muito grande (>5MB)", variant: "destructive" }); return; }
    if (password.length < 1) { toast({ title: "Informe a senha", variant: "destructive" }); return; }

    setLoading(true);
    try {
      const file_base64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("upload-certificate", {
        body: {
          company_id: companyId,
          password,
          file_base64,
          file_name: file.name,
          subject_name: subject || null,
          expires_at: expires ? new Date(expires).toISOString() : null,
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast({ title: "Certificado salvo", description: "Senha criptografada com sucesso." });
      setOpen(false);
      setCompanyId("");
      load();
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Falha", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (cert: Cert) => {
    if (!confirm("Remover este certificado?")) return;
    await supabase.storage.from("certificates").remove([cert.storage_path]);
    const { error } = await supabase.from("certificates").delete().eq("id", cert.id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    load();
  };

  const companyOf = (id: string) => companies.find((c) => c.id === id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold mb-1">Certificados A1</h1>
          <p className="text-muted-foreground">Arquivo .pfx + senha. Tudo criptografado no servidor.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button disabled={companies.length === 0}><Plus className="h-4 w-4 mr-2" /> Novo certificado</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Upload de certificado A1</DialogTitle></DialogHeader>
            <form onSubmit={handleUpload} className="space-y-3">
              <div>
                <Label>Empresa</Label>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.trade_name || c.legal_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Arquivo .pfx / .p12</Label>
                <Input name="file" type="file" accept=".pfx,.p12" required />
              </div>
              <div>
                <Label>Senha do certificado</Label>
                <Input name="password" type="password" required />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Titular (opcional)</Label><Input name="subject" /></div>
                <div><Label>Validade (opcional)</Label><Input name="expires_at" type="date" /></div>
              </div>
              <Button type="submit" disabled={loading} className="w-full">
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Enviar
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {companies.length === 0 && (
        <Card className="p-4 bg-warning/10 border-warning/30 text-sm">
          Cadastre uma empresa antes de fazer upload de certificado.
        </Card>
      )}

      {certs.length === 0 ? (
        <Card className="p-12 text-center">
          <KeyRound className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">Nenhum certificado cadastrado.</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {certs.map((c) => {
            const co = companyOf(c.company_id);
            const expired = c.expires_at && new Date(c.expires_at) < new Date();
            return (
              <Card key={c.id} className="p-4 flex items-center justify-between">
                <div>
                  <div className="font-display font-semibold flex items-center gap-2">
                    {co ? (co.trade_name || co.legal_name) : "—"}
                    {expired && <Badge variant="destructive">Expirado</Badge>}
                    {c.is_active && !expired && <Badge variant="secondary">Ativo</Badge>}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {c.subject_name || c.storage_path.split("/").pop()}
                    {c.expires_at && ` · vence em ${new Date(c.expires_at).toLocaleDateString("pt-BR")}`}
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(c)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Certificates;
