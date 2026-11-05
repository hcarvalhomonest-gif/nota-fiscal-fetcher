import { describe, expect, it } from "vitest";
import { certificateLabel, invoiceStatus, isMonthOpen } from "../lib/fiscal-rules";
import { classifyInvoice, matchesInvoiceType } from "../../supabase/functions/_shared/invoice-type";

describe("regras fiscais solicitadas", () => {
  it("distingue Monest nova de antiga HC sem expor o nome do arquivo", () => {
    const cert = { id: "123", is_procurador: true, subject_name: "Monest" };
    expect(certificateLabel({ ...cert, storage_path: "MONEST_ANTIGA_HC_CONTABILIDADE.pfx" })).toBe("Monest antiga HC");
    expect(certificateLabel({ ...cert, storage_path: "MONEST_CONSULTORIA.pfx" })).toBe("Monest nova");
  });
  it("separa downloads de emitidas e tomadas pelo CNPJ representado", () => {
    expect(classifyInvoice("12.345.678/0001-90", "998", "12345678000190")).toBe("emitida");
    expect(classifyInvoice("998", "12345678000190", "12345678000190")).toBe("tomada");
    expect(matchesInvoiceType("emitida", "tomada")).toBe(false);
    expect(matchesInvoiceType("tomada", "tomada")).toBe(true);
    expect(classifyInvoice("998", "997", "12345678000190")).toBeNull();
  });
  it("indica ativa ou cancelada sem presumir a situação de notas antigas", () => {
    expect(invoiceStatus(true)).toBe("Cancelada");
    expect(invoiceStatus(false)).toBe("Ativa");
    expect(invoiceStatus(null)).toBe("Não informada");
  });
  it("mantém meses fechados até a escolha explícita", () => {
    expect(isMonthOpen({}, "2026-11")).toBe(false);
    expect(isMonthOpen({ "2026-11": true }, "2026-11")).toBe(true);
  });
});