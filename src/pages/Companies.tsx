import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Building2 } from "lucide-react";

type Company = {
  id: string; cnpj: string; legal_name: string; trade_name: string | null;
  municipality: string | null; state: string | null;
};

const schema = z.object({
  cnpj: z.string().trim().regex(/^\d{14}$|^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, "CNPJ inválido"),
  legal_name: z.string().trim().min(2).max(200),
  trade_name: z.string().trim().max(200).optional(),
  municipality: z.string().trim().max(100).optional(),
  state: z.string().trim().max(2).optional(),
});

const Companies = () => {
  const [items, setItems] = useState<Company[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const load = async () => {
    const { data } = await supabase.from("companies").select("*").order("created_at", { ascending: false });
    setItems(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = schema.safeParse({
      cnpj: fd.get("cnpj"),
      legal_name: fd.get("legal_name"),
      trade_name: fd.get("trade_name") || undefined,
      municipality: fd.get("municipality") || undefined,
      state: fd.get("state") || undefined,
    });
    if (!parsed.success) {
      toast({ title: "Dados inválidos", description: parsed.error.issues[0].message, variant: "destructive" });
      return;
    }
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("companies").insert({
      owner_id: user!.id,
      cnpj: parsed.data.cnpj!.replace(/\D/g, ""),
      legal_name: parsed.data.legal_name!,
      trade_name: parsed.data.trade_name ?? null,
      municipality: parsed.data.municipality ?? null,
      state: parsed.data.state?.toUpperCase() ?? null,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    setOpen(false);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remover esta empresa? Certificados e jobs vinculados também serão excluídos.")) return;
    const { error } = await supabase.from("companies").delete().eq("id", id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    load();
  };

  const formatCnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold mb-1">Empresas</h1>
          <p className="text-muted-foreground">Cadastre as empresas que vão emitir/baixar NFS-e.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Nova empresa</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova empresa</DialogTitle></DialogHeader>
            <form onSubmit={handleCreate} className="space-y-3">
              <div><Label>CNPJ</Label><Input name="cnpj" required placeholder="00.000.000/0000-00" /></div>
              <div><Label>Razão social</Label><Input name="legal_name" required /></div>
              <div><Label>Nome fantasia</Label><Input name="trade_name" /></div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2"><Label>Município</Label><Input name="municipality" /></div>
                <div><Label>UF</Label><Input name="state" maxLength={2} /></div>
              </div>
              <Button type="submit" disabled={loading} className="w-full">Salvar</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {items.length === 0 ? (
        <Card className="p-12 text-center">
          <Building2 className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">Nenhuma empresa cadastrada ainda.</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {items.map((c) => (
            <Card key={c.id} className="p-4 flex items-center justify-between">
              <div>
                <div className="font-display font-semibold">{c.trade_name || c.legal_name}</div>
                <div className="text-sm text-muted-foreground">
                  {formatCnpj(c.cnpj)} · {c.legal_name}
                  {c.municipality && ` · ${c.municipality}/${c.state ?? ""}`}
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => handleDelete(c.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default Companies;
