import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { FileStack, Download, FileText, FileCode, Archive, Loader2 } from "lucide-react";

type Invoice = {
  id: string; chave_acesso: string | null; numero: string | null;
  data_emissao: string | null; tomador_nome: string | null;
  tomador_documento: string | null; valor_total: number | null;
  xml_path: string | null; pdf_path: string | null; job_id: string;
};

const Invoices = () => {
  const [items, setItems] = useState<Invoice[]>([]);
  const [filter, setFilter] = useState("");
  const [zipping, setZipping] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("invoices").select("*").order("data_emissao", { ascending: false }).limit(500);
      setItems(data ?? []);
    })();
  }, []);

  const downloadOne = async (path: string) => {
    const { data, error } = await supabase.storage.from("invoices").download(path);
    if (error || !data) { toast({ title: "Erro", description: error?.message, variant: "destructive" }); return; }
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url; a.download = path.split("/").pop()!; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadZip = async () => {
    setZipping(true);
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const filtered = items.filter(matches);
      for (const inv of filtered) {
        for (const p of [inv.xml_path, inv.pdf_path]) {
          if (!p) continue;
          const { data } = await supabase.storage.from("invoices").download(p);
          if (data) zip.file(p.split("/").pop()!, data);
        }
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `notas-${Date.now()}.zip`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setZipping(false);
    }
  };

  const matches = (i: Invoice) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (i.numero ?? "").toLowerCase().includes(q)
      || (i.tomador_nome ?? "").toLowerCase().includes(q)
      || (i.chave_acesso ?? "").toLowerCase().includes(q);
  };

  const filtered = items.filter(matches);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold mb-1">Notas baixadas</h1>
          <p className="text-muted-foreground">{filtered.length} de {items.length} notas</p>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Buscar por número, tomador ou chave…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-72"
          />
          <Button onClick={downloadZip} disabled={zipping || filtered.length === 0}>
            {zipping ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Archive className="h-4 w-4 mr-2" />}
            Baixar ZIP
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <FileStack className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">Nenhuma nota baixada ainda.</p>
        </Card>
      ) : (
        <div className="grid gap-2">
          {filtered.map((inv) => (
            <Card key={inv.id} className="p-3 flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-medium">Nº {inv.numero ?? "—"}</span>
                  {inv.data_emissao && (
                    <span className="text-xs text-muted-foreground">
                      {new Date(inv.data_emissao).toLocaleDateString("pt-BR")}
                    </span>
                  )}
                  {inv.valor_total && (
                    <span className="text-sm font-semibold text-primary ml-auto md:ml-0">
                      R$ {inv.valor_total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
                <div className="text-sm text-muted-foreground truncate">
                  {inv.tomador_nome ?? "—"}
                  {inv.chave_acesso && <span className="font-mono text-xs ml-2">{inv.chave_acesso.slice(0, 20)}…</span>}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                {inv.xml_path && (
                  <Button variant="ghost" size="icon" onClick={() => downloadOne(inv.xml_path!)} title="Baixar XML">
                    <FileCode className="h-4 w-4" />
                  </Button>
                )}
                {inv.pdf_path && (
                  <Button variant="ghost" size="icon" onClick={() => downloadOne(inv.pdf_path!)} title="Baixar PDF">
                    <FileText className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default Invoices;
