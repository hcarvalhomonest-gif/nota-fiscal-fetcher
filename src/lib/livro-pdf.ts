import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import monestIcon from "@/assets/monest-icon.png";
import { invoiceStatus } from "./fiscal-rules";

const INK: [number, number, number] = [15, 20, 36];
const VOLT: [number, number, number] = [190, 242, 60];
const PAPER: [number, number, number] = [236, 239, 245];

async function toDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(blob); });
}

export type LivroInvoice = {
  numero: string | null; serie: string | null; data_emissao: string | null;
  chave_acesso: string | null;
  prestador_cnpj: string | null; prestador_razao: string | null;
  tomador_documento: string | null; tomador_nome: string | null;
  valor_servicos: number | null; valor_total: number | null;
  cancelada: boolean | null;
};

export type LivroTipo = "emitida" | "tomada";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDoc = (d: string | null) => {
  const s = (d ?? "").replace(/\D/g, "");
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return d ?? "";
};

export async function gerarLivroPdf(opts: {
  tipo: LivroTipo; empresa: { legal_name: string; cnpj: string };
  competencia: string; // YYYY-MM
  notas: LivroInvoice[];
}) {
  const { tipo, empresa, competencia, notas } = opts;
  const [y, m] = competencia.split("-");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const logo = await toDataUrl(monestIcon).catch(() => null);
  const titulo = tipo === "emitida" ? "Livro de Serviços Prestados" : "Livro de Serviços Tomados";
  const sub = tipo === "emitida" ? "NFS-e emitidas" : "NFS-e recebidas";

  const ordenadas = [...notas].sort((a, b) => (a.data_emissao ?? "").localeCompare(b.data_emissao ?? ""));
  let total = 0;
  const body = ordenadas.map((n, i) => {
    const v = Number(n.valor_total ?? n.valor_servicos ?? 0);
    total += v;
    const cDoc = tipo === "emitida" ? n.tomador_documento : n.prestador_cnpj;
    const cNome = tipo === "emitida" ? n.tomador_nome : n.prestador_razao;
    return [
      String(i + 1),
      n.data_emissao ? new Date(n.data_emissao).toLocaleDateString("pt-BR") : "",
      n.numero ?? "", n.serie ?? "", fmtDoc(cDoc), cNome ?? "",
      n.chave_acesso ? n.chave_acesso.slice(-14) : "", invoiceStatus(n.cancelada), brl(v),
    ];
  });

  const header = () => {
    doc.setFillColor(...INK); doc.rect(0, 0, W, 30, "F");
    doc.setFillColor(...VOLT); doc.rect(0, 30, W, 1.5, "F");
    if (logo) doc.addImage(logo, "PNG", 12, 6, 18, 18);
    doc.setTextColor(...VOLT); doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.text("monest", 34, 14);
    doc.setTextColor(...PAPER); doc.setFontSize(12);
    doc.text(`${titulo}  ·  ${sub}`, 34, 21);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text(`Competência ${m}/${y}`, W - 12, 14, { align: "right" });
    doc.text(`${empresa.legal_name}`, W - 12, 19, { align: "right" });
    doc.text(`CNPJ ${fmtDoc(empresa.cnpj)}`, W - 12, 24, { align: "right" });
  };

  header();
  // Resumo
  doc.setTextColor(...INK);
  const box = (x: number, label: string, value: string) => {
    doc.setDrawColor(210, 214, 222); doc.setFillColor(247, 248, 251);
    doc.roundedRect(x, 37, 70, 16, 2, 2, "FD");
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(100, 108, 125);
    doc.text(label, x + 4, 43);
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...INK);
    doc.text(value, x + 4, 50);
  };
  box(12, "Quantidade de notas", String(ordenadas.length));
  box(86, "Valor total", brl(total));
  box(160, "Situação das notas", `${notas.filter((n) => n.cancelada === false).length} ativas · ${notas.filter((n) => n.cancelada === true).length} canceladas`);
  doc.setFontSize(8);
  doc.text(`Situação não informada: ${notas.filter((n) => n.cancelada == null).length} · Valor total inclui todas as notas listadas.`, 12, 57);

  autoTable(doc, {
    startY: 62,
    margin: { top: 37, left: 12, right: 12, bottom: 16 },
    head: [["#", "Emissão", "Número", "Série", tipo === "emitida" ? "CPF/CNPJ Tomador" : "CNPJ Prestador", tipo === "emitida" ? "Tomador" : "Prestador", "Chave (final)", "Situação", "Valor"]],
    body,
    showFoot: "lastPage",
    foot: [["", "", "", "", "", `Total — ${ordenadas.length} notas`, "", "", brl(total)]],
    styles: { fontSize: 8, cellPadding: 1.8, textColor: INK, lineColor: [225, 228, 235], lineWidth: 0.1 },
    headStyles: { fillColor: INK, textColor: VOLT, fontStyle: "bold" },
    footStyles: { fillColor: VOLT, textColor: INK, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 248, 251] },
    columnStyles: { 0: { cellWidth: 10 }, 7: { cellWidth: 26 }, 8: { halign: "right", cellWidth: 30 } },
    didDrawPage: () => {
      if (doc.getNumberOfPages() > 1) header();
      doc.setFontSize(7.5); doc.setTextColor(120, 128, 145); doc.setFont("helvetica", "normal");
      doc.text(`Monest Consultoria · gerado em ${new Date().toLocaleString("pt-BR")}`, 12, H - 7);
      doc.text(`Página ${doc.getNumberOfPages()}`, W - 12, H - 7, { align: "right" });
    },
  });

  // Assinatura
  let yEnd = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 22;
  if (yEnd > H - 25) { doc.addPage(); header(); yEnd = 60; }
  doc.setDrawColor(...INK);
  doc.line(30, yEnd, 120, yEnd); doc.line(W - 120, yEnd, W - 30, yEnd);
  doc.setFontSize(8); doc.setTextColor(...INK);
  doc.text("Responsável pela empresa", 75, yEnd + 5, { align: "center" });
  doc.text("Contador responsável — Monest", W - 75, yEnd + 5, { align: "center" });

  const nome = `Livro_${tipo === "emitida" ? "Emitidas" : "Tomadas"}_${empresa.cnpj.replace(/\D/g, "")}_${y}-${m}.pdf`;
  doc.save(nome);
}
