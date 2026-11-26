/**
 * Planos de amostragem por atributos (ABNT NBR 5426), conforme a Tabela 1 da norma MAR 71000/021D
 * (critérios de seleção de amostra, nível I, inspeção simples normal), usada na perícia visual.
 */

export type FaixaAmostragem = { de: number; ate: number; amostras: number; ped: number; ac: number; re: number };

/** Tabela 1 — Critérios de seleção de amostra nível I (Simples - Normal). PED: amostra dobrada. */
export const TABELA_NIVEL_I: FaixaAmostragem[] = [
  { de: 2, ate: 15, amostras: 2, ped: 4, ac: 0, re: 1 },
  { de: 16, ate: 25, amostras: 3, ped: 6, ac: 0, re: 1 },
  { de: 26, ate: 90, amostras: 5, ped: 10, ac: 0, re: 1 },
  { de: 91, ate: 150, amostras: 8, ped: 16, ac: 0, re: 1 },
  { de: 151, ate: 280, amostras: 13, ped: 26, ac: 1, re: 2 },
  { de: 281, ate: 500, amostras: 20, ped: 40, ac: 1, re: 2 },
  { de: 501, ate: 1200, amostras: 32, ped: 64, ac: 2, re: 3 },
  { de: 1201, ate: 3200, amostras: 50, ped: 100, ac: 3, re: 4 },
  { de: 3201, ate: 10000, amostras: 80, ped: 160, ac: 5, re: 6 },
  { de: 10001, ate: 35000, amostras: 125, ped: 250, ac: 7, re: 8 },
  { de: 35001, ate: 150000, amostras: 200, ped: 400, ac: 10, re: 11 },
  { de: 150001, ate: 500000, amostras: 315, ped: 630, ac: 14, re: 15 },
  { de: 500001, ate: Infinity, amostras: 500, ped: 1000, ac: 21, re: 22 },
];

export const NORMA_AMOSTRAGEM = "MAR 71000/021D (Tabela 1) — ABNT NBR 5426, nível I, inspeção simples normal";

/** Faixa da tabela para o tamanho do lote. Lote de 1 peça: inspeciona a peça (100%). */
export function faixaDoLote(lote: number): FaixaAmostragem | null {
  if (!(lote > 0)) return null;
  if (lote < 2) return { de: 1, ate: 1, amostras: 1, ped: 1, ac: 0, re: 1 };
  return TABELA_NIVEL_I.find((f) => lote >= f.de && lote <= f.ate) ?? null;
}

/** Quantidade a inspecionar: a amostra da tabela (dobrada nos itens PED), nunca maior que o próprio lote. */
export function amostraDoLote(lote: number, ped: boolean) {
  const f = faixaDoLote(lote);
  if (!f) return null;
  return { ...f, n: Math.min(lote, ped ? f.ped : f.amostras) };
}

/**
 * Itens PED: Conjunto camuflado multipropósito e Conjunto operativo (gandola e calça).
 * Reconhecidos pela marca "(PED)" na descrição ou pelo nome do conjunto.
 */
export function ehPed(...textos: (string | null | undefined)[]) {
  const t = textos.filter(Boolean).join(" ").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  return /\(\s*PED\s*\)|\bPED\b/.test(t)
    || /CAMUF\w*\s+MULTI\s*-?\s*PROPOSITO/.test(t)
    || /CONJUNTO\s+OPERATIVO/.test(t)
    || (/\bOPERATIV[OA]\b/.test(t) && /\b(GANDOLA|CALCA)\b/.test(t));
}

/**
 * Distribui a amostra entre os tamanhos pela participação de cada um no lote (item 4.3 da norma):
 * decimais desprezados, e quem daria menos de 1 recebe 1.
 */
export function distribuirAmostra(n: number, partes: { chave: string; qtd: number }[]) {
  const total = partes.reduce((s, p) => s + p.qtd, 0);
  return partes.map((p) => ({ chave: p.chave, qtd: p.qtd, amostra: total ? Math.min(p.qtd, Math.max(1, Math.floor((n * p.qtd) / total))) : 0 }));
}
