import "server-only";
import { sql } from "./db";

/** Consultas da área Gerencial (análises de tramitação). Datas no horário de Brasília. */

const TZ = "America/Sao_Paulo";
export const hojeSP = () => new Date().toLocaleDateString("sv-SE", { timeZone: TZ });

export function somarDias(iso: string, n: number) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Período [de, ate] validado (datas AAAA-MM-DD, no máximo `maxDias`). */
export function periodo(de: unknown, ate: unknown, padraoDias: number, maxDias = 731) {
  const ok = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
  let fim = ok(ate) ? (ate as string) : hojeSP();
  let ini = ok(de) ? (de as string) : somarDias(fim, -(padraoDias - 1));
  if (ini > fim) [ini, fim] = [fim, ini];
  if (somarDias(ini, maxDias - 1) < fim) ini = somarDias(fim, -(maxDias - 1));
  return { de: ini, ate: fim };
}

const inicio = (d: string) => sql`(${d}::date)::timestamp at time zone ${TZ}`;
const fimDia = (d: string) => sql`(${d}::date + 1)::timestamp at time zone ${TZ}`;

// ---------------- Visão geral ----------------

export type SetorAgora = {
  chave: string; nome: string; prazo: number; total: number; verde: number; amarelo: number; vermelho: number;
  media: number | null; maximo: number | null; valor: string;
};
export type NFParada = { id: number; numero: string; emit_nome: string; valor: string; oc: string | null; dias: number; chave: string };

export async function visaoGeral(prazoReprov: number, de: string, ate: string) {
  const [setores, reprovadas, paradas, [kpi], [armazenar]] = await Promise.all([
    sql<SetorAgora[]>`
      select 'e' || e.id as chave, e.nome, e.prazo_dias as prazo, count(n.id)::int as total,
             count(n.id) filter (where n.d <= e.prazo_dias * 0.7)::int as verde,
             count(n.id) filter (where n.d > e.prazo_dias * 0.7 and n.d <= e.prazo_dias)::int as amarelo,
             count(n.id) filter (where n.d > e.prazo_dias)::int as vermelho,
             avg(n.d) as media, max(n.d) as maximo, coalesce(sum(n.valor), 0) as valor
      from etapas e
      left join (select id, etapa_id, valor, extract(epoch from now() - etapa_desde) / 86400 as d from notas where status = 'em_tramite') n
        on n.etapa_id = e.id
      where e.ativo group by e.id order by e.ordem`,
    sql<SetorAgora[]>`
      select 'reprovadas' as chave, 'Reprovadas' as nome, ${prazoReprov}::int as prazo, count(*)::int as total,
             count(*) filter (where d <= ${prazoReprov} * 0.7)::int as verde,
             count(*) filter (where d > ${prazoReprov} * 0.7 and d <= ${prazoReprov})::int as amarelo,
             count(*) filter (where d > ${prazoReprov})::int as vermelho,
             avg(d) as media, max(d) as maximo, coalesce(sum(valor), 0) as valor
      from (select valor, extract(epoch from now() - etapa_desde) / 86400 as d from notas where status = 'reprovada') x`,
    sql<NFParada[]>`
      select id, numero, emit_nome, valor, oc, d as dias, chave from (
        select n.id, n.numero, n.emit_nome, n.valor, n.oc, extract(epoch from now() - n.etapa_desde) / 86400 as d,
               case when n.status = 'reprovada' then 'reprovadas' else 'e' || n.etapa_id end as chave,
               row_number() over (partition by case when n.status = 'reprovada' then 0 else n.etapa_id end, n.status order by n.etapa_desde) as rn
        from notas n where n.status in ('em_tramite', 'reprovada')) x
      where rn <= 10 order by chave, dias desc`,
    sql`
      select
        (select count(*)::int from notas where status in ('em_tramite','reprovada')) as abertas,
        (select coalesce(sum(valor), 0) from notas where status in ('em_tramite','reprovada')) as valor_aberto,
        (select count(*)::int from notas n join etapas e on e.id = n.etapa_id
           where n.status = 'em_tramite' and now() - n.etapa_desde > make_interval(days => e.prazo_dias)) +
        (select count(*)::int from notas where status = 'reprovada' and now() - etapa_desde > make_interval(days => ${prazoReprov})) as fora_prazo,
        (select avg(extract(epoch from now() - recebida_em) / 86400) from notas where status in ('em_tramite','reprovada')) as idade_media,
        (select count(*)::int from notas where recebida_em >= ${inicio(de)} and recebida_em < ${fimDia(ate)}) as recebidas,
        (select count(*)::int from notas where status = 'finalizada' and concluida_em >= ${inicio(de)} and concluida_em < ${fimDia(ate)}) as finalizadas,
        (select coalesce(sum(valor), 0) from notas where status = 'finalizada' and concluida_em >= ${inicio(de)} and concluida_em < ${fimDia(ate)}) as valor_finalizado,
        (select count(*)::int from notas where status = 'retirada' and concluida_em >= ${inicio(de)} and concluida_em < ${fimDia(ate)}) as retiradas,
        (select count(distinct nota_id)::int from eventos where tipo = 'reprovacao' and criado_em >= ${inicio(de)} and criado_em < ${fimDia(ate)}) as reprovadas,
        (select avg(extract(epoch from (concluida_em - recebida_em)) / 86400) from notas
           where status = 'finalizada' and concluida_em >= ${inicio(de)} and concluida_em < ${fimDia(ate)}) as tempo_medio,
        (select percentile_cont(0.5) within group (order by extract(epoch from (concluida_em - recebida_em)) / 86400) from notas
           where status = 'finalizada' and concluida_em >= ${inicio(de)} and concluida_em < ${fimDia(ate)}) as tempo_mediano,
        (select count(distinct oc)::int from notas where oc is not null and recebida_em >= ${inicio(de)} and recebida_em < ${fimDia(ate)}) as ocs`,
    sql`select count(*)::int as n from notas where arrecadada_em is not null and armazenada_em is null and status in ('em_tramite','finalizada')`,
  ]);
  return { setores: [...setores, ...reprovadas], paradas, kpi, paraArmazenar: armazenar.n as number };
}

// ---------------- Evolução dos tempos ----------------

export type PontoMes = { mes: string; n: number; media: number; p25: number; mediana: number; p75: number; minimo: number; maximo: number };

/** Tempo por mês: total (recebimento → finalização) ou tempo de permanência numa etapa (somando passagens repetidas). */
export async function evolucaoTempos(metrica: "total" | number, meses: number): Promise<PontoMes[]> {
  const desde = meses > 0
    ? sql`(date_trunc('month', now() at time zone ${TZ}) - make_interval(months => ${meses - 1}))::timestamp at time zone ${TZ}`
    : sql`'-infinity'::timestamptz`;
  const base = metrica === "total"
    ? sql`select concluida_em as quando, extract(epoch from (concluida_em - recebida_em)) / 86400 as dur
          from notas where status = 'finalizada' and concluida_em >= ${desde}`
    : sql`select max(saida) as quando, sum(extract(epoch from (saida - entrada)) / 86400) as dur
          from permanencias where etapa_id = ${metrica} and status = 'em_tramite' and saida is not null
          group by nota_id having max(saida) >= ${desde}`;
  const linhas = await sql`
    select to_char(quando at time zone ${TZ}, 'YYYY-MM') as mes, count(*)::int as n, avg(dur) as media,
           percentile_cont(0.25) within group (order by dur) as p25, percentile_cont(0.5) within group (order by dur) as mediana,
           percentile_cont(0.75) within group (order by dur) as p75, min(dur) as minimo, max(dur) as maximo
    from (${base}) x group by 1 order by 1`;
  return linhas.map((l) => ({
    mes: l.mes, n: l.n, media: Number(l.media), p25: Number(l.p25), mediana: Number(l.mediana), p75: Number(l.p75), minimo: Number(l.minimo), maximo: Number(l.maximo),
  }));
}

/** Tendência como no sistema antigo: média móvel de 3 meses, variação do início ao fim e consistência da direção. */
export function tendencia(pontos: PontoMes[]) {
  if (pontos.length < 2) return null;
  const mm = pontos.map((_, i) => {
    const janela = pontos.slice(Math.max(0, i - 2), i + 1);
    return janela.reduce((s, p) => s + p.media, 0) / janela.length;
  });
  const ini = mm[0], fim = mm[mm.length - 1];
  if (!ini) return null;
  const variacao = (fim - ini) / ini;
  const passos = mm.slice(1).map((v, i) => Math.sign(v - mm[i]));
  const consistencia = passos.length ? passos.filter((s) => s === Math.sign(variacao)).length / passos.length : 0;
  return { variacao, consistencia, meses: pontos.length, inicial: ini, final: fim };
}

// ---------------- Produtividade diária ----------------

export type Movimento = { etapa_id: number; dia: string; avancos: number; retornos: number };

/** NF que saíram de cada etapa por dia: para frente (avanço, finalização, reprovação) e devolvidas. */
export async function produtividade(de: string, ate: string) {
  const mov = sql`
    select m.*, (m.criado_em at time zone ${TZ})::date as dia from (
      select ev.nota_id, ev.tipo, ev.usuario_nome, ev.criado_em,
             lag(ev.para_etapa_id) over w as de_etapa, lag(ev.para_status) over w as de_status
      from eventos ev where ev.movimento
      window w as (partition by ev.nota_id order by ev.criado_em, ev.id)) m
    where m.de_status = 'em_tramite' and m.de_etapa is not null
      and m.criado_em >= ${inicio(de)} and m.criado_em < ${fimDia(ate)}
      and m.tipo in ('avanco', 'finalizacao', 'reprovacao', 'retorno')`;
  const [porDia, porUsuario] = await Promise.all([
    sql<Movimento[]>`select de_etapa as etapa_id, to_char(dia, 'YYYY-MM-DD') as dia,
                            count(*) filter (where tipo <> 'retorno')::int as avancos, count(*) filter (where tipo = 'retorno')::int as retornos
                     from (${mov}) x group by 1, 2 order by 1, 2`,
    sql<{ etapa_id: number; usuario: string; n: number }[]>`
      select de_etapa as etapa_id, coalesce(usuario_nome, '(importado sem usuário)') as usuario, count(*)::int as n
      from (${mov}) x where tipo <> 'retorno' group by 1, 2 order by 1, n desc`,
  ]);
  return { porDia, porUsuario };
}

export function diasDoPeriodo(de: string, ate: string) {
  const dias: { data: string; fimDeSemana: boolean }[] = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) {
    const dow = new Date(d + "T12:00:00Z").getUTCDay();
    dias.push({ data: d, fimDeSemana: dow === 0 || dow === 6 });
  }
  return dias;
}

// ---------------- Fornecedores ----------------

export async function porFornecedor(de: string, ate: string) {
  return sql`
    select n.emit_cnpj, max(n.emit_nome) as nome,
      count(*) filter (where n.recebida_em >= ${inicio(de)} and n.recebida_em < ${fimDia(ate)})::int as recebidas,
      coalesce(sum(n.valor) filter (where n.recebida_em >= ${inicio(de)} and n.recebida_em < ${fimDia(ate)}), 0) as valor,
      count(*) filter (where n.status = 'finalizada' and n.concluida_em >= ${inicio(de)} and n.concluida_em < ${fimDia(ate)})::int as finalizadas,
      count(*) filter (where exists (select 1 from eventos ev where ev.nota_id = n.id and ev.tipo = 'reprovacao'
                                     and ev.criado_em >= ${inicio(de)} and ev.criado_em < ${fimDia(ate)}))::int as reprovadas,
      avg(extract(epoch from (n.concluida_em - n.recebida_em)) / 86400)
        filter (where n.status = 'finalizada' and n.concluida_em >= ${inicio(de)} and n.concluida_em < ${fimDia(ate)}) as tempo_medio,
      count(*) filter (where n.status in ('em_tramite','reprovada'))::int as abertas,
      count(distinct n.oc) filter (where n.recebida_em >= ${inicio(de)} and n.recebida_em < ${fimDia(ate)})::int as ocs
    from notas n
    group by n.emit_cnpj
    having count(*) filter (where (n.recebida_em >= ${inicio(de)} and n.recebida_em < ${fimDia(ate)})
                               or (n.concluida_em >= ${inicio(de)} and n.concluida_em < ${fimDia(ate)})
                               or n.status in ('em_tramite','reprovada')) > 0
    order by recebidas desc, abertas desc, nome
    limit 300`;
}
