import { describe, expect, it } from "vitest";
import { readNfseEvent } from "../../supabase/functions/_shared/nfse-event";

const KEY = "31062002212345678000190000000000001234567890123456";

describe("eventos de cancelamento do ADN", () => {
  it("reconhece o cancelamento com chave e grupo dentro de pedRegEvento", () => {
    const tree = { evento: { infEvento: { pedRegEvento: { infPedReg: { chNFSe: KEY, e101101: { xDesc: "Cancelamento de NFS-e" } } } } } };
    expect(readNfseEvent(tree)).toEqual({ isEvent: true, cancelledKey: KEY });
  });
  it("reconhece cancelamento por substituição", () => {
    const tree = { procEventoNFSe: { evento: { infEvento: { pedRegEvento: { infPedReg: { chNFSe: KEY, e105102: {} } } } } } };
    expect(readNfseEvent(tree).cancelledKey).toBe(KEY);
  });
  it("evento que não cancela não vira nota nem cancela", () => {
    const tree = { evento: { infEvento: { pedRegEvento: { infPedReg: { chNFSe: KEY, e101103: {} } } } } };
    expect(readNfseEvent(tree)).toEqual({ isEvent: true, cancelledKey: null });
  });
  it("uma nota normal não é tratada como evento", () => {
    const tree = { NFSe: { infNFSe: { nNFSe: "12", DPS: { infDPS: {} } } } };
    expect(readNfseEvent(tree).isEvent).toBe(false);
  });
});
