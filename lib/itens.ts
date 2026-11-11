import "server-only";
import { sql } from "./db";
import { ehInterno, type Usuario } from "./auth";
import { visivel } from "./notas";
import { soDigitos } from "./format";

/** Normaliza para comparação: minúsculas, sem acentos. */
export const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// palavras que não ajudam a encontrar o item ("calça nº 42", "camisa de algodão", "tam M")
const IGNORAR = new Set(["de", "da", "do", "das", "dos", "e", "com", "para", "em", "n", "no", "na", "nr", "num", "o", "a", "tam", "tamanho"]);

/** Divide a pesquisa em palavras. Palavras curtas (M, G, GG) e números (42) só casam como palavra inteira. */
export function termos(q: string) {
  return normalizar(q)
    .split(/[^a-z0-9./-]+/)
    .map((t) => t.replace(/^[./-]+|[./-]+$/g, ""))
    .filter((t) => t && !IGNORAR.has(t))
    .slice(0, 8)
    .map((t) => ({ t, exato: t.length <= 2 || /^\d+$/.test(t) }));
}

export type FiltrosItens = { q?: string; situacao?: string; cnpj?: string; de?: string; ate?: string; pagina?: string };

export type ItemEncontrado = {
  nota_id: number; numero: string; emit_nome: string; emit_cnpj: string; status: string; etapa_nome: string | null; recebida_em: Date; oc: string | null;
  n: number; codigo: string | null; descricao: string; un: string | null; qtd: number; vunit: number; vtotal: number; ncm: string | null;
};

export const ITENS_POR_PAGINA = 100;
const SEMELHANCA = 0.55;
const dataValida = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

function base(u: Usuario, f: FiltrosItens) {
  const lista = termos(f.q ?? "");
  const conds = [visivel(u)];
  const s = f.situacao ?? "";
  if (s === "em_aberto") conds.push(sql`n.status in ('em_tramite','reprovada')`);
  else if (["em_tramite", "reprovada", "finalizada", "retirada"].includes(s)) conds.push(sql`n.status = ${s}`);
  if (f.cnpj && ehInterno(u)) conds.push(sql`n.emit_cnpj = ${soDigitos(f.cnpj)}`);
  const de = dataValida(f.de), ate = dataValida(f.ate);
  if (de) conds.push(sql`n.recebida_em >= (${de}::date)::timestamp at time zone 'America/Sao_Paulo'`);
  if (ate) conds.push(sql`n.recebida_em < (${ate}::date + 1)::timestamp at time zone 'America/Sao_Paulo'`);
  const ondeNota = conds.reduce((a, b) => sql`${a} and ${b}`);

  const casa = lista.map(({ t, exato }) =>
    exato
      ? sql`it.txt ~ ${"(^|[^a-z0-9])" + t.replace(/[.]/g, "\\.") + "([^a-z0-9]|$)"}`
      : sql`(it.txt like ${"%" + t + "%"} or word_similarity(${t}, it.txt) >= ${SEMELHANCA})`,
  );
  const pontos = lista.length
    ? lista.map(({ t, exato }) => (exato ? sql`1` : sql`(case when it.txt like ${"%" + t + "%"} then 1 else word_similarity(${t}, it.txt) end)`))
        .reduce((a, b) => sql`${a} + ${b}`)
    : sql`0`;
  const ondeItem = casa.length ? casa.reduce((a, b) => sql`${a} and ${b}`) : sql`false`;

  const cte = sql`
    with it as (
      select n.id as nota_id, n.numero, n.emit_nome, n.emit_cnpj, n.status, e.nome as etapa_nome, n.recebida_em, n.oc,
             i.value as item, i.ordinality as ord,
             lower(unaccent(coalesce(i.value->>'descricao', '') || ' ' || coalesce(i.value->>'codigo', ''))) as txt
      from notas n
      left join etapas e on e.id = n.etapa_id
      cross join lateral jsonb_array_elements(case when jsonb_typeof(n.itens) = 'array' then n.itens else '[]'::jsonb end) with ordinality i
      where ${ondeNota}
    ), achados as (select it.*, ${pontos} as pontos from it where ${ondeItem})`;
  return { cte, temTermos: lista.length > 0 };
}

export async function buscarItens(u: Usuario, f: FiltrosItens, todos = false) {
  const { cte, temTermos } = base(u, f);
  if (!temTermos) return { linhas: [] as ItemEncontrado[], total: 0, notas: 0, valor: 0, porUnidade: [] as { un: string; qtd: number }[], pagina: 1 };
  const pagina = Math.max(1, Number(f.pagina) || 1);
  const sel = sql`
    select nota_id, numero, emit_nome, emit_cnpj, status, etapa_nome, recebida_em, oc, (item->>'n')::int as n,
           item->>'codigo' as codigo, item->>'descricao' as descricao, item->>'un' as un, item->>'ncm' as ncm,
           coalesce((item->>'qtd')::numeric, 0)::float8 as qtd, coalesce((item->>'vUnit')::numeric, 0)::float8 as vunit,
           coalesce((item->>'vTotal')::numeric, 0)::float8 as vtotal
    from achados order by pontos desc, recebida_em desc, nota_id desc, ord`;
  const [linhas, [tot], porUnidade] = await Promise.all([
    todos ? sql<ItemEncontrado[]>`${cte} ${sel} limit 10000` : sql<ItemEncontrado[]>`${cte} ${sel} limit ${ITENS_POR_PAGINA} offset ${(pagina - 1) * ITENS_POR_PAGINA}`,
    sql`${cte} select count(*)::int as total, count(distinct nota_id)::int as notas,
                      coalesce(sum(coalesce((item->>'vTotal')::numeric, 0)), 0)::float8 as valor from achados`,
    sql<{ un: string; qtd: number }[]>`${cte} select coalesce(nullif(upper(item->>'un'), ''), '—') as un,
                      sum(coalesce((item->>'qtd')::numeric, 0))::float8 as qtd from achados group by 1 order by 2 desc limit 6`,
  ]);
  return { linhas, total: tot.total as number, notas: tot.notas as number, valor: tot.valor as number, porUnidade, pagina };
}

export async function contarNotasSemItens(u: Usuario) {
  const [r] = await sql`select count(*) filter (where n.itens is null or jsonb_array_length(case when jsonb_typeof(n.itens) = 'array' then n.itens else '[]'::jsonb end) = 0)::int as sem,
                               count(*)::int as total from notas n where ${visivel(u)}`;
  return r as { sem: number; total: number };
}
