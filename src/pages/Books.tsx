import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { BookOpen, Loader2 } from "lucide-react";
import { gerarLivroPdf, type LivroTipo } from "@/lib/livro-pdf";

type Company = { id: string; cnpj: string; legal_name: string; trade_name: string | null };

const Books = () => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [competencia, setCompetencia] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
  });
  const [busy, setBusy] = useState<LivroTipo | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    supabase.from("companies").select("id, cnpj, legal_name, trade_name").order("legal_name")
      .then(({ data }) => setCompanies(data ?? []));
  }, []);

  const gerar = async (tipo: LivroTipo) => {
    const empresa = companies.find((c) => c.id === companyId);
    if (!empresa) { toast({ title: "Selecione a empresa", variant: "destructive" }); return; }
    setBusy(tipo);
    const [y, m] = competencia.split("-").map(Number);
    const ini = new Date(Date.UTC(y, m - 1, 1)).toISOString();
    const fim = new Date(Date.UTC(y, m, 1)).toISOString();
    const { data, error } = await supabase
      .from("invoices")
      .select("numero, serie, data_emissao, chave_acesso, prestador_cnpj, prestador_razao, tomador_documento, tomador_nome, valor_servicos, valor_total, download_jobs!inner(company_id)")
      .eq("download_jobs.company_id", empresa.id)
      .eq("tipo", tipo)
      .gte("data_emissao", ini).lt("data_emissao", fim)
      .limit(5000);
    setBusy(null);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    // remove duplicatas (mesma nota baixada em jobs diferentes)
    const vistos = new Set<string>();
    const notas = (data ?? []).filter((n) => {
      const k = n.chave_acesso ?? `${n.numero}-${n.serie}`;
      if (vistos.has(k)) return false; vistos.add(k); return true;
    });
    if (notas.length === 0) {
      toast({ title: "Nenhuma nota nesse mês", description: "Faça o download do período antes de gerar o livro." });
      return;
    }
    gerarLivroPdf({ tipo, empresa, competencia, notas });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold mb-1">Livros fiscais</h1>
        <p className="text-muted-foreground">Livro mensal de notas emitidas e tomadas, pronto para imprimir.</p>
      </div>
      <Card className="p-6 space-y-4 max-w-xl">
        <div>
          <Label>Empresa</Label>
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
            <SelectContent>
              {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.trade_name || c.legal_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Competência</Label>
          <Input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          <Button onClick={() => gerar("emitida")} disabled={!!busy}>
            {busy === "emitida" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BookOpen className="h-4 w-4 mr-2" />}
            Livro de emitidas
          </Button>
          <Button variant="secondary" onClick={() => gerar("tomada")} disabled={!!busy}>
            {busy === "tomada" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BookOpen className="h-4 w-4 mr-2" />}
            Livro de tomadas
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default Books;
