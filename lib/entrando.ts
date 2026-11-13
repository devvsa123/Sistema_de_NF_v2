import "server-only";
import { sql } from "./db";
import { correlacionarNota } from "./estoque";
import { normalizar } from "./itens";
import { soDigitos } from "./format";
import type { ItemNF } from "./nfe";

/** NF "entrando": em tramitação, ou finalizadas e arrecadadas que ainda não foram armazenadas. */
const ENTRANDO = sql`(n.status = 'em_tramite' or (n.status = 'finalizada' and n.arrecadada_em is not null and n.armazenada_em is null))`;

export type FiltrosEntrando = { q?: string; etapa?: string; cnpj?: string; ordem?: string; correlacao?: string };

export type NotaDoItem = { id: number; numero: string; empresa: string; etapa: string; qtd: number; un: string; tamanho?: string; caixas: number | null; sobMedida: boolean };
export type GrupoEntrando = {
  chave: string; pi: string | null; descricao: string; cxp: number | null; qtd: number; un: string; caixas: number; semCxp: boolean;
  porEtapa: { etapa: string; qtd: number }[]; notas: NotaDoItem[];
};

export async function itensEntrando(f: FiltrosEntrando) {
  const conds = [ENTRANDO, sql`jsonb_typeof(n.itens) = 'array' and jsonb_array_length(n.itens) > 0`];
  if (f.etapa === "armazenar") conds.push(sql`n.status = 'finalizada'`);
  else if (f.etapa && /^\d+$/.test(f.etapa)) conds.push(sql`n.status = 'em_tramite' and n.etapa_id = ${Number(f.etapa)}`);
  if (f.cnpj) conds.push(sql`n.emit_cnpj = ${soDigitos(f.cnpj)}`);
  const onde = conds.reduce((a, b) => sql`${a} and ${b}`);
  const [notas, [semItens]] = await Promise.all([
    sql<{ id: number; numero: string; emit_cnpj: string; emit_nome: string; itens: ItemNF[]; status: string; etapa: string | null; ordem: number | null; sob_medida: boolean }[]>`
      select n.id, n.numero, n.emit_cnpj, n.emit_nome, n.itens, n.status, e.nome as etapa, e.ordem, n.sob_medida
      from notas n left join etapas e on e.id = n.etapa_id where ${onde} order by n.recebida_em`,
    sql`select count(*)::int as n from notas n where ${ENTRANDO} and (n.itens is null or jsonb_typeof(n.itens) <> 'array' or jsonb_array_length(n.itens) = 0)`,
  ]);

  const ordemEtapa = new Map<string, number>();
  const grupos = new Map<string, GrupoEntrando>();
  let catalogoVazio = false;
  // correlação em lotes (uma consulta curta por NF)
  const correl: Awaited<ReturnType<typeof correlacionarNota>>[] = [];
  for (let i = 0; i < notas.length; i += 12) correl.push(...(await Promise.all(notas.slice(i, i + 12).map((n) => correlacionarNota(n)))));
  for (const [k, n] of notas.entries()) {
    const etapa = n.status === "finalizada" ? "Para armazenar" : (n.etapa ?? "—");
    ordemEtapa.set(etapa, n.status === "finalizada" ? 999 : (n.ordem ?? 500));
    const r = correl[k];
    catalogoVazio ||= r.catalogoVazio;
    const linhas = r.catalogoVazio
      ? n.itens.map((i) => ({ descricao: i.descricao, qtd: i.qtd, un: i.un, tamanho: undefined as string | undefined, item: null, caixas: null }))
      : r.linhas;
    for (const l of linhas) {
      const chave = l.item ? `pi:${l.item.pi}` : `nf:${normalizar(l.descricao).replace(/\s+/g, " ").trim()}`;
      let g = grupos.get(chave);
      if (!g) {
        g = { chave, pi: l.item?.pi ?? null, descricao: l.item?.descricao ?? l.descricao, cxp: l.item?.cxp ?? null, qtd: 0, un: l.un, caixas: 0, semCxp: false, porEtapa: [], notas: [] };
        grupos.set(chave, g);
      }
      g.qtd += Number(l.qtd) || 0;
      if (l.caixas) g.caixas += l.caixas.total; else if (l.item) g.semCxp = true;
      const pe = g.porEtapa.find((x) => x.etapa === etapa);
      if (pe) pe.qtd += Number(l.qtd) || 0; else g.porEtapa.push({ etapa, qtd: Number(l.qtd) || 0 });
      g.notas.push({ id: n.id, numero: n.numero, empresa: n.emit_nome, etapa, qtd: Number(l.qtd) || 0, un: l.un, tamanho: l.tamanho, caixas: l.caixas?.total ?? null, sobMedida: n.sob_medida });
    }
  }

  let lista = [...grupos.values()];
  for (const g of lista) g.porEtapa.sort((a, b) => (ordemEtapa.get(a.etapa) ?? 0) - (ordemEtapa.get(b.etapa) ?? 0));
  const termos = normalizar(f.q ?? "").split(/\s+/).filter(Boolean);
  if (termos.length) {
    lista = lista.filter((g) => {
      const txt = normalizar(`${g.pi ?? ""} ${g.descricao} ${g.notas.map((x) => `${x.numero} ${x.empresa}`).join(" ")}`);
      return termos.every((t) => (t.length <= 2 || /^\d+$/.test(t) ? new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`).test(txt) : txt.includes(t)));
    });
  }
  if (f.correlacao === "sem") lista = lista.filter((g) => !g.pi);
  lista.sort(f.ordem === "nome" ? (a, b) => a.descricao.localeCompare(b.descricao, "pt-BR") : f.ordem === "notas" ? (a, b) => b.notas.length - a.notas.length || b.qtd - a.qtd : (a, b) => b.qtd - a.qtd);

  return {
    grupos: lista,
    resumo: {
      notas: new Set(lista.flatMap((g) => g.notas.map((x) => x.id))).size,
      itens: lista.length,
      qtd: lista.reduce((s, g) => s + g.qtd, 0),
      caixas: lista.reduce((s, g) => s + g.caixas, 0),
      semCorrelacao: lista.filter((g) => !g.pi).length,
      semItens: semItens.n as number,
    },
    catalogoVazio,
  };
}
