import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type LivroInvoice = {
  numero: string | null; serie: string | null; data_emissao: string | null;
  chave_acesso: string | null;
  prestador_cnpj: string | null; prestador_razao: string | null;
  tomador_documento: string | null; tomador_nome: string | null;
  valor_servicos: number | null; valor_total: number | null;
};

export type LivroTipo = "emitida" | "tomada";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDoc = (d: string | null) => {
  const s = (d ?? "").replace(/\D/g, "");
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return d ?? "";
};

export function gerarLivroPdf(opts: {
  tipo: LivroTipo; empresa: { legal_name: string; cnpj: string };
  competencia: string; // YYYY-MM
  notas: LivroInvoice[];
}) {
  const { tipo, empresa, competencia, notas } = opts;
  const [y, m] = competencia.split("-");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const titulo = tipo === "emitida" ? "Livro de Registro de Serviços Prestados (NFS-e Emitidas)" : "Livro de Registro de Serviços Tomados (NFS-e Recebidas)";

  doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text(titulo, 14, 14);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(`Contribuinte: ${empresa.legal_name}  —  CNPJ ${fmtDoc(empresa.cnpj)}`, 14, 21);
  doc.text(`Competência: ${m}/${y}`, 14, 26);

  const ordenadas = [...notas].sort((a, b) => (a.data_emissao ?? "").localeCompare(b.data_emissao ?? ""));
  let total = 0;
  const body = ordenadas.map((n) => {
    const v = Number(n.valor_total ?? n.valor_servicos ?? 0);
    total += v;
    const contraparteDoc = tipo === "emitida" ? n.tomador_documento : n.prestador_cnpj;
    const contraparteNome = tipo === "emitida" ? n.tomador_nome : n.prestador_razao;
    return [
      n.data_emissao ? new Date(n.data_emissao).toLocaleDateString("pt-BR") : "",
      n.numero ?? "", n.serie ?? "",
      fmtDoc(contraparteDoc), contraparteNome ?? "",
      brl(v),
    ];
  });

  autoTable(doc, {
    startY: 31,
    head: [["Emissão", "Número", "Série", tipo === "emitida" ? "CPF/CNPJ Tomador" : "CNPJ Prestador", tipo === "emitida" ? "Tomador" : "Prestador", "Valor"]],
    body,
    foot: [["", "", "", "", `Total (${ordenadas.length} notas)`, brl(total)]],
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [20, 26, 44], textColor: 255 },
    footStyles: { fillColor: [235, 238, 245], textColor: 20, fontStyle: "bold" },
    columnStyles: { 5: { halign: "right" } },
    didDrawPage: () => {
      const page = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.text(`Página ${page} — gerado por Monest em ${new Date().toLocaleString("pt-BR")}`, 14, doc.internal.pageSize.getHeight() - 6);
    },
  });

  const nome = `Livro_${tipo === "emitida" ? "Emitidas" : "Tomadas"}_${empresa.cnpj.replace(/\D/g, "")}_${y}-${m}.pdf`;
  doc.save(nome);
}
