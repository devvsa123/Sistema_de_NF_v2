import "server-only";
import { sql } from "./db";
import { correlacionarNota, type LinhaCorrelacao } from "./estoque";
import { tamanhoDoEstoque } from "./correlacao";
import { amostraDoLote, distribuirAmostra, ehPed, faixaDoLote } from "./amostragem";
import type { ItemNF } from "./nfe";

const tiraTamanho = (texto: string, tam: string | null) =>
  !tam ? texto : texto.replace(new RegExp(`(\\s*[-–]?\\s*(TAM\\.?|TAMANHO|N[º°O]?\\.?)?\\s*)${tam.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "").trim() || texto;

/**
 * Lote = o mesmo item em todos os tamanhos. A chave vem da própria NF (código do fornecedor + descrição sem o
 * tamanho), porque o catálogo do estoque pode escrever cada tamanho de um jeito; o nome mostrado é o do estoque.
 */
function nomeDoLote(l: LinhaCorrelacao) {
  const tam = l.tamanho ?? tamanhoDoEstoque(l.item?.descricao ?? "") ?? tamanhoDoEstoque(l.descricao);
  const nfBase = tiraTamanho(l.descricao, tam).toUpperCase().replace(/\s+/g, " ");
  const codigo = String(l.codigo ?? "").replace(/\s*TAM\s+\S+$/i, "").trim().toUpperCase();
  return { chave: `${codigo}|${nfBase}`, nome: tiraTamanho(l.item?.descricao ?? l.descricao, tam), tam };
}

export type LotePericia = {
  nome: string; ped: boolean; qtd: number; un: string; amostras: number; amostrasTabela: number; ac: number; re: number;
  faixa: string; tamanhos: { tamanho: string; qtd: number; amostra: number; itens: number[] }[];
};

/** Amostragem da perícia visual para a NF: por item (todos os tamanhos juntos), com a amostra distribuída por tamanho. */
export async function amostragemPericia(nota: { emit_cnpj: string; itens: ItemNF[] | null }): Promise<LotePericia[]> {
  const { linhas } = await correlacionarNota(nota);
  const base = linhas.length ? linhas : (nota.itens ?? []).map((i) => ({ ref: String(i.n), n: i.n, descricao: i.descricao, infAd: i.infAd, qtd: i.qtd, un: i.un, item: null } as unknown as LinhaCorrelacao));
  const grupos = new Map<string, { nome: string; un: string; ped: boolean; partes: { tamanho: string; qtd: number; itens: number[] }[] }>();
  for (const l of base) {
    const { chave: base, nome, tam } = nomeDoLote(l);
    const chave = `${base}|${l.un}`;
    const g = grupos.get(chave) ?? { nome, un: l.un, ped: false, partes: [] };
    g.ped ||= ehPed(l.item?.descricao, l.descricao, l.infAd);
    const t = tam ?? "—";
    const p = g.partes.find((x) => x.tamanho === t);
    if (p) { p.qtd += Number(l.qtd) || 0; p.itens.push(l.n); } else g.partes.push({ tamanho: t, qtd: Number(l.qtd) || 0, itens: [l.n] });
    grupos.set(chave, g);
  }
  const lotes: LotePericia[] = [];
  for (const g of grupos.values()) {
    const qtd = g.partes.reduce((s, p) => s + p.qtd, 0);
    const a = amostraDoLote(Math.round(qtd), g.ped);
    if (!a) continue;
    const dist = g.partes.length > 1 ? distribuirAmostra(a.n, g.partes.map((p) => ({ chave: p.tamanho, qtd: p.qtd }))) : [{ chave: g.partes[0].tamanho, qtd, amostra: a.n }];
    lotes.push({
      nome: g.nome, ped: g.ped, qtd, un: g.un, amostras: a.n, amostrasTabela: g.ped ? a.ped : a.amostras, ac: a.ac, re: a.re,
      faixa: a.ate === Infinity ? `a partir de ${a.de.toLocaleString("pt-BR")}` : `${a.de.toLocaleString("pt-BR")} a ${a.ate.toLocaleString("pt-BR")}`,
      tamanhos: g.partes.map((p, i) => ({ tamanho: p.tamanho, qtd: p.qtd, amostra: dist[i]?.amostra ?? 0, itens: p.itens })),
    });
  }
  return lotes;
}

// ------------------------------------------------------------------ plano de contagem por pesagem (temporário)

export type LinhaPesagem = {
  ref: string; n: number; item: string; pi: string | null; qtd: number; un: string; cxp: number | null;
  volumes: number | null;     // caixas pelo padrão do estoque (CXP)
  pesar: number | null;       // volumes a pesar (amostra)
  ac: number; re: number;
};
export type NfPesagem = { id: number; numero: string; empresa: string; etapa: string; recebida: Date; linhas: LinhaPesagem[]; volumes: number; pesar: number; semCxp: number };

/**
 * Levantamento das NF que aguardam a contagem (por etapa), item a item: volumes pelo CXP e quantos volumes
 * pesar pela mesma tabela (o lote é o número de volumes do item). Item sem CXP fica em contagem 100%.
 */
export async function levantamentoPesagem(etapas: number[]): Promise<NfPesagem[]> {
  if (!etapas.length) return [];
  const notas = await sql<{ id: number; numero: string; emit_nome: string; emit_cnpj: string; itens: ItemNF[] | null; etapa: string; recebida_em: Date }[]>`
    select n.id, n.numero, n.emit_nome, n.emit_cnpj, n.itens, e.nome as etapa, n.recebida_em
    from notas n join etapas e on e.id = n.etapa_id
    where n.status = 'em_tramite' and n.etapa_id in ${sql(etapas)} and jsonb_typeof(n.itens) = 'array' and jsonb_array_length(n.itens) > 0
    order by e.ordem, n.recebida_em, n.id limit 300`;
  const saida: NfPesagem[] = [];
  for (const n of notas) {
    const { linhas } = await correlacionarNota(n);
    const ls: LinhaPesagem[] = linhas.map((l) => {
      const vol = l.caixas?.total ?? null;
      const f = vol ? faixaDoLote(vol) : null;
      return {
        ref: l.ref, n: l.n, item: l.item?.descricao ?? l.descricao, pi: l.item?.pi ?? null, qtd: Number(l.qtd) || 0, un: l.un,
        cxp: l.item?.cxp ?? null, volumes: vol, pesar: vol && f ? Math.min(vol, f.amostras) : null, ac: f?.ac ?? 0, re: f?.re ?? 1,
      };
    });
    saida.push({
      id: n.id, numero: n.numero, empresa: n.emit_nome, etapa: n.etapa, recebida: n.recebida_em, linhas: ls,
      volumes: ls.reduce((s, l) => s + (l.volumes ?? 0), 0), pesar: ls.reduce((s, l) => s + (l.pesar ?? 0), 0), semCxp: ls.filter((l) => !l.volumes).length,
    });
  }
  return saida;
}
