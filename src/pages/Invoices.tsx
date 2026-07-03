import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { FileStack, FileText, FileCode, Archive, Loader2, FileSpreadsheet, ChevronDown, ChevronRight } from "lucide-react";

type Invoice = {
  id: string; chave_acesso: string | null; numero: string | null; serie: string | null;
  data_emissao: string | null;
  prestador_cnpj: string | null; prestador_razao: string | null;
  tomador_nome: string | null; tomador_documento: string | null;
  valor_total: number | null; valor_servicos: number | null;
  xml_path: string | null; pdf_path: string | null; job_id: string;
  created_at: string;
};

const MESES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** Retorna "YYYY-MM" (competência = ano+mês da emissão; cai para created_at). */
function competenciaKey(inv: Invoice): string {
  const iso = inv.data_emissao ?? inv.created_at;
  return iso ? iso.slice(0, 7) : "sem-data";
}

function competenciaLabel(key: string): string {
  if (key === "sem-data") return "Sem data";
  const [y, m] = key.split("-");
  return `${MESES_PT[parseInt(m, 10) - 1]} / ${y}`;
}

const Invoices = () => {
  const [items, setItems] = useState<Invoice[]>([]);
  const [filter, setFilter] = useState("");
  const [zipping, setZipping] = useState<string | null>(null);
  const [xlsxing, setXlsxing] = useState<string | null>(null);
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({});
  const { toast } = useToast();

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("invoices")
        .select("*")
        .order("data_emissao", { ascending: false })
        .limit(2000);
      setItems(data ?? []);
    })();
  }, []);

  const matches = (i: Invoice) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (i.numero ?? "").toLowerCase().includes(q)
      || (i.tomador_nome ?? "").toLowerCase().includes(q)
      || (i.chave_acesso ?? "").toLowerCase().includes(q)
      || (i.tomador_documento ?? "").toLowerCase().includes(q);
  };

  const filtered = useMemo(() => items.filter(matches), [items, filter]);

  const grupos = useMemo(() => {
    const map = new Map<string, Invoice[]>();
    for (const inv of filtered) {
      const k = competenciaKey(inv);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(inv);
    }
    // ordena chaves desc (mais recente primeiro); "sem-data" vai por último
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "sem-data") return 1;
      if (b === "sem-data") return -1;
      return a < b ? 1 : -1;
    });
  }, [filtered]);

  const toggleMonth = (k: string) =>
    setOpenMonths((s) => ({ ...s, [k]: !(s[k] ?? true) }));

  const downloadOne = async (path: string) => {
    const { data, error } = await supabase.storage.from("invoices").download(path);
    if (error || !data) {
      toast({ title: "Erro", description: error?.message, variant: "destructive" });
      return;
    }
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url; a.download = path.split("/").pop()!; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadZipMes = async (key: string, invs: Invoice[]) => {
    setZipping(key);
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      for (const inv of invs) {
        for (const p of [inv.xml_path, inv.pdf_path]) {
          if (!p) continue;
          const { data } = await supabase.storage.from("invoices").download(p);
          if (data) zip.file(p.split("/").pop()!, data);
        }
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `notas-${key}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setZipping(null);
    }
  };

  const downloadXlsxMes = async (key: string, invs: Invoice[]) => {
    setXlsxing(key);
    try {
      const XLSX = await import("xlsx");
      const fmtData = (iso: string | null) =>
        iso ? new Date(iso).toLocaleDateString("pt-BR") : "";
      const fmtDataHora = (iso: string | null) =>
        iso ? new Date(iso).toLocaleString("pt-BR") : "";

      const rows = invs.map((i) => ({
        Numero: i.numero ?? "",
        CnpjEmit: i.prestador_cnpj ?? "",
        RzEmit: i.prestador_razao ?? "",
        CnpjDest: i.tomador_documento ?? "",
        RzDest: i.tomador_nome ?? "",
        CnpjRem: "-",
        CnpjTom: i.tomador_documento ?? "",
        Valor: i.valor_total ?? i.valor_servicos ?? 0,
        DtEmissao: fmtData(i.data_emissao),
        DtDownload: fmtDataHora(i.created_at),
        Chave: i.chave_acesso ?? "",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      // Formata coluna "Valor" como moeda BR
      const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
      for (let r = 1; r <= range.e.r; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c: 7 })]; // Valor = col H
        if (cell && typeof cell.v === "number") cell.z = '#,##0.00';
      }
      ws["!cols"] = [
        { wch: 12 }, { wch: 18 }, { wch: 40 }, { wch: 18 }, { wch: 40 },
        { wch: 10 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 20 }, { wch: 48 },
      ];
      const wb = XLSX.utils.book_new();
      // Nome de aba do Excel não pode conter : \ / ? * [ ] e tem limite de 31 chars
      const sheetName = competenciaLabel(key).replace(/[:\\/?*[\]]/g, "-").slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      XLSX.writeFile(wb, `notas-${key}.xlsx`);
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setXlsxing(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold mb-1">Notas baixadas</h1>
          <p className="text-muted-foreground">
            {filtered.length} de {items.length} notas · {grupos.length} {grupos.length === 1 ? "mês" : "meses"} de competência
          </p>
        </div>
        <Input
          placeholder="Buscar por número, tomador ou chave…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-72"
        />
      </div>

      {grupos.length === 0 ? (
        <Card className="p-12 text-center">
          <FileStack className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">Nenhuma nota baixada ainda.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {grupos.map(([key, invs]) => {
            const open = openMonths[key] ?? true;
            const total = invs.reduce((s, i) => s + (i.valor_total ?? 0), 0);
            return (
              <Card key={key} className="overflow-hidden">
                <div className="p-4 flex items-center justify-between gap-3 bg-muted/30 flex-wrap">
                  <button
                    type="button"
                    onClick={() => toggleMonth(key)}
                    className="flex items-center gap-2 text-left"
                  >
                    {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <span className="font-semibold text-lg">{competenciaLabel(key)}</span>
                    <span className="text-sm text-muted-foreground">
                      · {invs.length} {invs.length === 1 ? "nota" : "notas"} · R$ {total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                  </button>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => downloadXlsxMes(key, invs)}
                      disabled={xlsxing === key}
                    >
                      {xlsxing === key
                        ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        : <FileSpreadsheet className="h-4 w-4 mr-2" />}
                      Planilha Excel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => downloadZipMes(key, invs)}
                      disabled={zipping === key}
                    >
                      {zipping === key
                        ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        : <Archive className="h-4 w-4 mr-2" />}
                      ZIP do mês
                    </Button>
                  </div>
                </div>

                {open && (
                  <div className="p-2 grid gap-1">
                    {invs.map((inv) => (
                      <div
                        key={inv.id}
                        className="p-3 flex items-center justify-between gap-3 rounded-md hover:bg-muted/40"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm font-medium">Nº {inv.numero ?? "—"}</span>
                            {inv.data_emissao && (
                              <span className="text-xs text-muted-foreground">
                                {new Date(inv.data_emissao).toLocaleDateString("pt-BR")}
                              </span>
                            )}
                            {inv.valor_total !== null && inv.valor_total !== undefined && (
                              <span className="text-sm font-semibold text-primary">
                                R$ {inv.valor_total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground truncate">
                            {inv.tomador_nome ?? "—"}
                            {inv.chave_acesso && (
                              <span className="font-mono text-xs ml-2">
                                {inv.chave_acesso.slice(0, 20)}…
                              </span>
                            )}
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
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Invoices;
