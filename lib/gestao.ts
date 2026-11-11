import "server-only";
import { sql } from "./db";
import type { Etapa } from "./fluxo";

/**
 * Ferramentas de gestão do fluxo: a tramitação é tratada como uma fila única e contínua.
 * Fontes: tabela `eventos` (movimentações) e a visão `permanencias` (entrada/saída de cada NF em cada etapa).
 */

const TZ = "America/Sao_Paulo";
const desdeDias = (dias: number) => sql`now() - make_interval(days => ${dias})`;

/** Movimentações com a etapa/situação de onde a NF saiu. */
const MOV = sql`
  select ev.nota_id, ev.tipo, ev.criado_em, ev.para_etapa_id, ev.para_status, ev.usuario_nome,
         lag(ev.para_etapa_id) over w as de_etapa, lag(ev.para_status) over w as de_status
  from eventos ev where ev.movimento
  window w as (partition by ev.nota_id order by ev.criado_em, ev.id)`;

/** Passagens pelas etapas em trâmite (sem os períodos como reprovada). */
const PASS = sql`select nota_id, etapa_id, entrada, saida from permanencias where status = 'em_tramite' and etapa_id is not null`;

// ---------------------------------------------------------------- Fluxo e gargalos

export type Balanco = {
  etapa_id: number; entradas: number; saidas: number; despachadas: number; devolvidas: number; wip: number; wip_inicio: number;
};

/** Entradas × saídas de cada etapa numa janela de dias, estoque atual e no início da janela. */
export async function balanco(dias: number) {
  return sql<Balanco[]>`
    with m as (${MOV}),
    ent as (select para_etapa_id as id, count(*)::int as n from m
            where para_status = 'em_tramite' and criado_em >= ${desdeDias(dias)} group by 1),
    sai as (select de_etapa as id, count(*)::int as saidas,
                   count(*) filter (where tipo in ('avanco','finalizacao','reprovacao'))::int as despachadas,
                   count(*) filter (where tipo = 'retorno')::int as devolvidas
            from m where de_status = 'em_tramite' and criado_em >= ${desdeDias(dias)} group by 1),
    ini as (select etapa_id as id, count(*)::int as n from (${PASS}) p
            where entrada < ${desdeDias(dias)} and (saida is null or saida >= ${desdeDias(dias)}) group by 1),
    agora as (select etapa_id as id, count(*)::int as n from notas where status = 'em_tramite' group by 1)
    select e.id as etapa_id, coalesce(ent.n, 0) as entradas, coalesce(sai.saidas, 0) as saidas, coalesce(sai.despachadas, 0) as despachadas,
           coalesce(sai.devolvidas, 0) as devolvidas, coalesce(agora.n, 0) as wip, coalesce(ini.n, 0) as wip_inicio
    from etapas e left join ent on ent.id = e.id left join sai on sai.id = e.id left join ini on ini.id = e.id left join agora on agora.id = e.id
    where e.ativo order by e.ordem`;
}

/** Estoque de NF em cada etapa ao fim de cada dia (diagrama de fluxo acumulado). Chave 0 = reprovadas. */
export async function estoqueDiario(de: string, ate: string) {
  return sql<{ dia: string; chave: number; n: number }[]>`
    with d as (select gs::date as dia, ((gs::date + 1)::timestamp at time zone ${TZ}) as fim
               from generate_series(${de}::date, ${ate}::date, interval '1 day') gs),
    p as (select nota_id, etapa_id, status, entrada, saida from permanencias
          where status in ('em_tramite','reprovada') and (saida is null or saida >= (${de}::date)::timestamp at time zone ${TZ}))
    select to_char(d.dia, 'YYYY-MM-DD') as dia, case when p.status = 'reprovada' then 0 else p.etapa_id end as chave, count(*)::int as n
    from d join p on p.entrada < d.fim and (p.saida is null or p.saida >= d.fim)
    group by 1, 2 order by 1`;
}

/** Chegadas, saídas e estoque total por semana. */
export async function fluxoSemanal(semanas: number) {
  return sql<{ semana: string; chegadas: number; saidas: number; estoque: number }[]>`
    with s as (
      select gs::date as ini, ((gs::date)::timestamp at time zone ${TZ}) as t0, ((gs::date + 7)::timestamp at time zone ${TZ}) as t1
      from generate_series(date_trunc('week', now() at time zone ${TZ})::date - (${semanas - 1} * 7), date_trunc('week', now() at time zone ${TZ})::date, interval '7 days') gs)
    select to_char(s.ini, 'YYYY-MM-DD') as semana,
      (select count(*)::int from notas where recebida_em >= s.t0 and recebida_em < s.t1) as chegadas,
      (select count(*)::int from notas where status in ('finalizada','retirada','arquivada') and concluida_em >= s.t0 and concluida_em < s.t1) as saidas,
      (select count(*)::int from notas where recebida_em < least(s.t1, now()) and (concluida_em is null or concluida_em >= least(s.t1, now()))
                                         and status <> 'arquivada') as estoque
    from s order by s.ini`;
}

// ---------------------------------------------------------------- Fila (FIFO) e envelhecimento

/**
 * Aderência à fila: saídas de cada etapa em que alguma NF mais antiga ficou para trás.
 * Tolerância de 1 hora, para não contar como fora de ordem as NF tramitadas juntas, no mesmo lote.
 */
export async function aderenciaFifo(dias: number) {
  return sql<{ etapa_id: number; saidas: number; fora: number }[]>`
    with p as (${PASS}), s as (select * from p where saida >= ${desdeDias(dias)})
    select s.etapa_id, count(*)::int as saidas,
           count(*) filter (where exists (
             select 1 from p q where q.etapa_id = s.etapa_id and q.nota_id <> s.nota_id
               and q.entrada < s.entrada - interval '1 hour' and (q.saida is null or q.saida > s.saida + interval '1 hour')))::int as fora
    from s group by 1`;
}

export type Ultrapassada = { id: number; numero: string; emit_nome: string; etapa_id: number; etapa: string; entrada: Date; dias: number; vezes: number };

/** NF que estão hoje numa etapa e já viram NF que chegaram depois saírem na frente. */
export async function ultrapassadas() {
  return sql<Ultrapassada[]>`
    with p as (${PASS}),
    atual as (select p.* from p join notas n on n.id = p.nota_id and n.status = 'em_tramite' and n.etapa_id = p.etapa_id where p.saida is null)
    select n.id, n.numero, n.emit_nome, a.etapa_id, e.nome as etapa, a.entrada,
           extract(epoch from now() - a.entrada) / 86400 as dias, count(o.nota_id)::int as vezes
    from atual a
    join notas n on n.id = a.nota_id
    join etapas e on e.id = a.etapa_id
    join p o on o.etapa_id = a.etapa_id and o.nota_id <> a.nota_id and o.entrada > a.entrada + interval '1 hour' and o.saida is not null
    group by n.id, a.etapa_id, e.nome, e.ordem, a.entrada
    order by vezes desc, a.entrada`;
}

export const FAIXAS_IDADE = [[0, 2, "até 2 dias"], [2, 5, "3 a 5"], [5, 10, "6 a 10"], [10, 20, "11 a 20"], [20, 30, "21 a 30"], [30, 60, "31 a 60"], [60, 1e9, "mais de 60"]] as const;

/** Quantas NF há em cada etapa por faixa de tempo parado. Chave 0 = reprovadas. */
export async function envelhecimento() {
  return sql<{ chave: number; faixa: number; n: number }[]>`
    select case when status = 'reprovada' then 0 else etapa_id end as chave,
           case ${FAIXAS_IDADE.map(([a, b], i) => sql`when d > ${a} and d <= ${b} then ${i} `).reduce((x, y) => sql`${x} ${y}`)} else 0 end as faixa,
           count(*)::int as n
    from (select status, etapa_id, extract(epoch from now() - etapa_desde) / 86400 as d from notas where status in ('em_tramite','reprovada')) x
    group by 1, 2`;
}

// ---------------------------------------------------------------- Retrabalho

export async function retrabalho(dias: number) {
  const [porEtapa, [geral], idasVoltas] = await Promise.all([
    sql<{ etapa_id: number; saidas: number; devolvidas: number; reprovadas: number }[]>`
      with m as (${MOV})
      select de_etapa as etapa_id, count(*)::int as saidas,
             count(*) filter (where tipo = 'retorno')::int as devolvidas,
             count(*) filter (where tipo = 'reprovacao')::int as reprovadas
      from m where de_status = 'em_tramite' and criado_em >= ${desdeDias(dias)} group by 1`,
    sql`select count(*)::int as finalizadas,
               count(*) filter (where not exists (select 1 from eventos ev where ev.nota_id = n.id and ev.tipo in ('retorno','reprovacao')))::int as de_primeira
        from notas n where n.status = 'finalizada' and n.concluida_em >= ${desdeDias(dias)}`,
    sql<{ id: number; numero: string; emit_nome: string; status: string; etapa_nome: string | null; devolucoes: number; reprovacoes: number; caminho: string }[]>`
      select n.id, n.numero, n.emit_nome, n.status, e.nome as etapa_nome,
             count(*) filter (where ev.tipo = 'retorno')::int as devolucoes,
             count(*) filter (where ev.tipo = 'reprovacao')::int as reprovacoes,
             string_agg(ev.para_nome, ' → ' order by ev.criado_em, ev.id) as caminho
      from notas n left join etapas e on e.id = n.etapa_id
      join eventos ev on ev.nota_id = n.id and ev.movimento
      where n.id in (select nota_id from eventos where tipo in ('retorno','reprovacao') and criado_em >= ${desdeDias(dias)})
      group by n.id, e.nome
      having count(*) filter (where ev.tipo in ('retorno','reprovacao')) >= 2
      order by count(*) filter (where ev.tipo in ('retorno','reprovacao')) desc, n.id desc
      limit 30`,
  ]);
  return { porEtapa, geral: geral as { finalizadas: number; de_primeira: number }, idasVoltas };
}

// ---------------------------------------------------------------- Previsão

export type Previsao = {
  id: number; numero: string; emit_nome: string; valor: string; etapa_id: number; etapa: string; dias_etapa: number; dias_total: number;
  restante: number; prevista: Date; total_previsto: number; estoura: boolean;
};

/** Tempo típico (mediana) de cada etapa nas passagens concluídas dos últimos 180 dias. */
async function medianas() {
  const r = await sql<{ etapa_id: number; mediana: number; n: number }[]>`
    select etapa_id, percentile_cont(0.5) within group (order by dur) as mediana, count(*)::int as n from (
      select nota_id, etapa_id, sum(extract(epoch from saida - entrada)) / 86400 as dur
      from permanencias where status = 'em_tramite' and saida is not null and etapa_id is not null
      group by 1, 2 having max(saida) >= now() - interval '180 days') x
    group by 1`;
  return new Map(r.map((x) => [x.etapa_id, Number(x.mediana)]));
}

/** Data prevista de finalização de cada NF em trâmite, pelo tempo típico das etapas que faltam. */
export async function previsoes(etapas: Etapa[]) {
  const [med, abertas] = await Promise.all([
    medianas(),
    sql<{ id: number; numero: string; emit_nome: string; valor: string; etapa_id: number; dias_etapa: number; dias_total: number }[]>`
      select id, numero, emit_nome, valor, etapa_id, extract(epoch from now() - etapa_desde) / 86400 as dias_etapa,
             extract(epoch from now() - recebida_em) / 86400 as dias_total
      from notas where status = 'em_tramite' and etapa_id is not null`,
  ]);
  const prazoTotal = etapas.reduce((s, e) => s + e.prazo_dias, 0);
  const tipico = (e: Etapa) => med.get(e.id) ?? e.prazo_dias;
  const agora = Date.now();
  const lista: Previsao[] = abertas.flatMap((n) => {
    const i = etapas.findIndex((e) => e.id === n.etapa_id);
    if (i < 0) return [];
    const atual = etapas[i];
    // na etapa atual: o que falta do tempo típico; se já passou dele, conta meio dia útil de folga
    const restoAtual = Math.max(tipico(atual) - Number(n.dias_etapa), 0.5);
    const restante = restoAtual + etapas.slice(i + 1).reduce((s, e) => s + tipico(e), 0);
    const total = Number(n.dias_total) + restante;
    return [{ ...n, etapa: atual.nome, dias_etapa: Number(n.dias_etapa), dias_total: Number(n.dias_total), restante,
      prevista: new Date(agora + restante * 864e5), total_previsto: total, estoura: total > prazoTotal }];
  });
  lista.sort((a, b) => a.prevista.getTime() - b.prevista.getTime());
  return { lista, prazoTotal, tipicos: etapas.map((e) => ({ etapa: e, dias: tipico(e), temHistorico: med.has(e.id) })) };
}

// ---------------------------------------------------------------- Alertas

export type NFAlerta = { id: number; numero: string; emit_nome: string; detalhe: string };
export type Alerta = { chave: string; nivel: "critico" | "atencao" | "info"; titulo: string; descricao: string; notas: NFAlerta[] };

export async function alertas(prazoReprov: number, etapas: Etapa[]): Promise<Alerta[]> {
  const nomeEtapa = new Map(etapas.map((e) => [e.id, e.nome]));
  const [dobro, reprov, armazenar, idas, ultra, bal14, prev] = await Promise.all([
    sql<(NFAlerta & { d: number; etapa: string; prazo: number })[]>`
      select n.id, n.numero, n.emit_nome, e.nome as etapa, e.prazo_dias as prazo, extract(epoch from now() - n.etapa_desde) / 86400 as d, '' as detalhe
      from notas n join etapas e on e.id = n.etapa_id
      where n.status = 'em_tramite' and now() - n.etapa_desde > make_interval(days => e.prazo_dias * 2)
      order by now() - n.etapa_desde desc`,
    sql<(NFAlerta & { d: number })[]>`
      select id, numero, emit_nome, extract(epoch from now() - etapa_desde) / 86400 as d, '' as detalhe
      from notas where status = 'reprovada' and now() - etapa_desde > make_interval(days => ${prazoReprov}) order by etapa_desde`,
    sql<(NFAlerta & { d: number })[]>`
      select id, numero, emit_nome, extract(epoch from now() - arrecadada_em) / 86400 as d, '' as detalhe
      from notas where arrecadada_em is not null and armazenada_em is null and status in ('em_tramite','finalizada')
        and now() - arrecadada_em > interval '7 days' order by arrecadada_em`,
    sql<(NFAlerta & { voltas: number; etapa: string | null })[]>`
      select n.id, n.numero, n.emit_nome, e.nome as etapa, count(*)::int as voltas, '' as detalhe
      from notas n left join etapas e on e.id = n.etapa_id join eventos ev on ev.nota_id = n.id and ev.tipo in ('retorno','reprovacao')
      where n.status in ('em_tramite','reprovada') group by n.id, e.nome having count(*) >= 2 order by voltas desc`,
    ultrapassadas(),
    balanco(14),
    previsoes(etapas),
  ]);
  const fmt = (d: number) => `${Math.round(d)} dias`;
  const lista: Alerta[] = [
    {
      chave: "dobro", nivel: "critico", titulo: "NF paradas há mais do dobro do prazo do setor",
      descricao: "Prioridade máxima: estas notas estão travando a fila.",
      notas: dobro.map((n) => ({ ...n, detalhe: `${n.etapa}: ${fmt(n.d)} (prazo ${n.prazo})` })),
    },
    {
      chave: "fifo", nivel: "atencao", titulo: "NF ultrapassadas na fila (3 ou mais NF passaram na frente)",
      descricao: "Notas mais antigas que ficaram para trás enquanto outras, que chegaram depois, já saíram do setor. Verifique se há impedimento registrado.",
      notas: ultra.filter((u) => u.vezes >= 3).map((u) => ({ ...u, detalhe: `${u.etapa}: ultrapassada por ${u.vezes} NF · há ${fmt(u.dias)} no setor` })),
    },
    {
      chave: "reprov", nivel: "atencao", titulo: `Reprovadas além do prazo de retirada (${prazoReprov} dias)`,
      descricao: "Cobrar a retirada do material pelo fornecedor ou registrar a solução.",
      notas: reprov.map((n) => ({ ...n, detalhe: `reprovada há ${fmt(n.d)}` })),
    },
    {
      chave: "armazenar", nivel: "atencao", titulo: "Arrecadadas aguardando armazenagem há mais de 7 dias",
      descricao: "Material já arrecadado que ainda não foi armazenado.",
      notas: armazenar.map((n) => ({ ...n, detalhe: `arrecadada há ${fmt(n.d)}` })),
    },
    {
      chave: "idas", nivel: "info", titulo: "NF em aberto com idas e voltas (2 ou mais devoluções/reprovações)",
      descricao: "Retrabalho recorrente: vale entender a causa com o setor e o fornecedor.",
      notas: idas.map((n) => ({ ...n, detalhe: `${n.voltas} retornos${n.etapa ? ` · hoje em ${n.etapa}` : ""}` })),
    },
    {
      chave: "previsao", nivel: "info", titulo: `NF que devem estourar o prazo total do caminho (${prev.prazoTotal} dias)`,
      descricao: "Pela previsão de finalização, estas notas vão terminar além da soma dos prazos das etapas.",
      notas: prev.lista.filter((p) => p.estoura).sort((a, b) => b.total_previsto - a.total_previsto)
        .map((p) => ({ ...p, detalhe: `${p.etapa} · total previsto ${fmt(p.total_previsto)}` })),
    },
  ];
  const acumulando = bal14.filter((b) => b.entradas - b.saidas >= 3);
  if (acumulando.length)
    lista.splice(1, 0, {
      chave: "acumulo", nivel: "atencao", titulo: "Setores acumulando NF nos últimos 14 dias",
      descricao: acumulando.map((b) => `${nomeEtapa.get(b.etapa_id)}: entraram ${b.entradas}, saíram ${b.saidas} (estoque ${b.wip_inicio} → ${b.wip})`).join(" · "),
      notas: [],
    });
  return lista;
}
