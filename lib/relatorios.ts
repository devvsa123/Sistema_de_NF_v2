import "server-only";
import { sql } from "./db";

const TZ = "America/Sao_Paulo";

/** Indicadores de um mês (formato AAAA-MM), no fuso de Brasília. */
export async function relatorioMensal(mes: string) {
  const ini = sql`(${mes + "-01"}::date)::timestamp at time zone ${TZ}`;
  const fim = sql`((${mes + "-01"}::date + interval '1 month'))::timestamp at time zone ${TZ}`;

  const [[resumo], porEtapa, porEmpresa, serie, reprovadas] = await Promise.all([
    sql`select
          (select count(*)::int from notas where recebida_em >= ${ini} and recebida_em < ${fim}) as recebidas,
          (select coalesce(sum(valor), 0) from notas where recebida_em >= ${ini} and recebida_em < ${fim}) as valor_recebido,
          (select count(*)::int from notas where status = 'finalizada' and concluida_em >= ${ini} and concluida_em < ${fim}) as finalizadas,
          (select count(distinct nota_id)::int from eventos where tipo = 'reprovacao' and criado_em >= ${ini} and criado_em < ${fim}) as reprovadas,
          (select count(*)::int from notas where status = 'retirada' and concluida_em >= ${ini} and concluida_em < ${fim}) as retiradas,
          (select avg(extract(epoch from (concluida_em - recebida_em)) / 86400) from notas
             where status = 'finalizada' and concluida_em >= ${ini} and concluida_em < ${fim}) as tempo_medio,
          (select percentile_cont(0.5) within group (order by extract(epoch from (concluida_em - recebida_em)) / 86400) from notas
             where status = 'finalizada' and concluida_em >= ${ini} and concluida_em < ${fim}) as tempo_mediano,
          (select max(extract(epoch from (concluida_em - recebida_em)) / 86400) from notas
             where status = 'finalizada' and concluida_em >= ${ini} and concluida_em < ${fim}) as tempo_maximo,
          (select count(*)::int from notas where status in ('em_tramite','reprovada')) as em_aberto`,
    // tempo médio de permanência por etapa, considerando as saídas ocorridas no mês
    sql`select e.id, e.nome, e.prazo_dias, e.ordem,
               count(p.*)::int as passagens,
               avg(extract(epoch from (p.saida - p.entrada)) / 86400) as media,
               max(extract(epoch from (p.saida - p.entrada)) / 86400) as maximo,
               count(*) filter (where p.saida - p.entrada > make_interval(days => e.prazo_dias))::int as fora_prazo
        from etapas e
        left join permanencias p on p.etapa_id = e.id and p.status = 'em_tramite' and p.saida >= ${ini} and p.saida < ${fim}
        where e.ativo group by e.id order by e.ordem`,
    sql`select n.emit_cnpj, max(n.emit_nome) as nome,
               count(*) filter (where n.recebida_em >= ${ini} and n.recebida_em < ${fim})::int as recebidas,
               count(*) filter (where n.status = 'finalizada' and n.concluida_em >= ${ini} and n.concluida_em < ${fim})::int as finalizadas,
               count(*) filter (where exists (select 1 from eventos ev where ev.nota_id = n.id and ev.tipo = 'reprovacao'
                                              and ev.criado_em >= ${ini} and ev.criado_em < ${fim}))::int as reprovadas,
               coalesce(sum(n.valor) filter (where n.recebida_em >= ${ini} and n.recebida_em < ${fim}), 0) as valor
        from notas n
        where (n.recebida_em >= ${ini} and n.recebida_em < ${fim}) or (n.concluida_em >= ${ini} and n.concluida_em < ${fim})
           or exists (select 1 from eventos ev where ev.nota_id = n.id and ev.tipo = 'reprovacao' and ev.criado_em >= ${ini} and ev.criado_em < ${fim})
        group by n.emit_cnpj order by recebidas desc, finalizadas desc, nome`,
    // últimos 12 meses
    sql`with meses as (
          select to_char(m, 'YYYY-MM') as mes, m::timestamp at time zone ${TZ} as ini, (m + interval '1 month')::timestamp at time zone ${TZ} as fim
          from generate_series((${mes + "-01"}::date - interval '11 months'), ${mes + "-01"}::date, interval '1 month') m)
        select mes,
          (select count(*)::int from notas where recebida_em >= ini and recebida_em < fim) as recebidas,
          (select count(*)::int from notas where status = 'finalizada' and concluida_em >= ini and concluida_em < fim) as finalizadas,
          (select count(distinct nota_id)::int from eventos where tipo = 'reprovacao' and criado_em >= ini and criado_em < fim) as reprovadas,
          (select avg(extract(epoch from (concluida_em - recebida_em)) / 86400) from notas
             where status = 'finalizada' and concluida_em >= ini and concluida_em < fim) as tempo_medio
        from meses order by mes`,
    sql`select n.id, n.numero, n.emit_nome, n.valor, ev.criado_em, ev.texto
        from eventos ev join notas n on n.id = ev.nota_id
        where ev.tipo = 'reprovacao' and ev.criado_em >= ${ini} and ev.criado_em < ${fim} order by ev.criado_em`,
  ]);
  return { resumo, porEtapa, porEmpresa, serie, reprovadas };
}
