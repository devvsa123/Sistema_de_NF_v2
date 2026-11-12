/**
 * Identifica o número da OC (Ordem de Compra) nos textos da NF.
 * O número tem sempre 7 dígitos (ex.: 1173226). Os fornecedores escrevem de vários jeitos:
 * "OC 1173226", "O.C. nº 1173226", "OC:1173226", "ORDEM DE COMPRA 1173226", "Ordem de Compra Nº 1.173.226", "PEDIDO 1173226".
 */

const NUMERO = String.raw`(\d\.?\d{3}\.?\d{3})(?![\d.]*\d)`;
const SEPARADOR = String.raw`[\s:.\-–=#/]*(?:N\s*[º°O.]?\s*\.?[\s:.\-–=#]*)?`;
const PALAVRA = String.raw`(?:ORDEM\s+DE\s+COMPRAS?|ORD\.?\s+(?:DE\s+)?COMPRAS?|O\s?\.\s?C\s?\.?|\bOCS?\b|\bOC(?=\d)|\bPEDIDO(?:\s+DE\s+COMPRAS?)?)`;
const RE = new RegExp(PALAVRA + SEPARADOR + NUMERO, "g");

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

/** Primeira OC encontrada nos textos, na ordem em que foram passados. Vazio se nenhuma. */
export function extrairOC(...textos: (string | null | undefined)[]): string {
  for (const t of textos) {
    if (!t) continue;
    const limpo = t.replace(/\D/g, "");
    if (/^\d{7}$/.test(limpo) && /^\s*[\d.]+\s*$/.test(t)) return limpo; // campo próprio do pedido (xPed) só com o número
    for (const m of normalizar(t).matchAll(RE)) return m[1].replace(/\./g, "");
  }
  return "";
}
