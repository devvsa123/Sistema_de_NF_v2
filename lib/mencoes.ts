import "server-only";
import { sql, type Tx } from "./db";
import type { Usuario } from "./auth";
import { registrarEvento } from "./fluxo";

/**
 * Mensagens: observações da NF em que usuários ou setores são marcados.
 * Cada pessoa marcada (diretamente ou pelo setor) recebe um aviso até dar "ciente";
 * a mensagem e o ciente ficam no histórico da NF.
 */

export type Destinatarios = { setores: { nome: string; pessoas: number }[]; usuarios: { id: number; nome: string; setores: string }[] };

/** Usuários internos ativos e setores do caminho que podem ser marcados. */
export async function destinatarios(): Promise<Destinatarios> {
  const [setores, usuarios] = await Promise.all([
    sql<{ nome: string; pessoas: number }[]>`
      select e.setor as nome, count(distinct u.id)::int as pessoas from etapas e
      left join usuario_etapas ue on ue.etapa_id = e.id left join usuarios u on u.id = ue.usuario_id and u.ativo and u.papel in ('interno', 'admin')
      where e.ativo group by e.setor order by min(e.ordem)`,
    sql<{ id: number; nome: string; setores: string }[]>`
      select u.id, u.nome, coalesce(string_agg(distinct e.setor, ', '), '') as setores from usuarios u
      left join usuario_etapas ue on ue.usuario_id = u.id left join etapas e on e.id = ue.etapa_id and e.ativo
      where u.ativo and u.papel in ('interno', 'admin') group by u.id order by u.nome`,
  ]);
  return { setores, usuarios };
}

/** Marcações vêm como "u:12" (usuário) ou "s:Perícia" (setor). */
export function lerMarcados(v: unknown): string[] {
  const lista = Array.isArray(v) ? v : typeof v === "string" && v.trim() ? (() => { try { return JSON.parse(v); } catch { return []; } })() : [];
  return [...new Set((lista as unknown[]).map(String).filter((m) => /^(u:\d+|s:.{1,60})$/.test(m)))].slice(0, 30);
}

/** Registra a observação com as marcações e cria os avisos. Devolve o id do registro no histórico. */
export async function observarComMarcacao(db: Tx, u: Usuario, notaId: number, texto: string, marcados: string[], tipo = "observacao") {
  const idsUsuarios = marcados.filter((m) => m.startsWith("u:")).map((m) => Number(m.slice(2)));
  const setores = marcados.filter((m) => m.startsWith("s:")).map((m) => m.slice(2));
  const pessoas = idsUsuarios.length
    ? await db<{ id: number; nome: string }[]>`select id, nome from usuarios where id in ${db(idsUsuarios)} and ativo and papel in ('interno', 'admin')`
    : [];
  const doSetor = setores.length
    ? await db<{ id: number; setor: string }[]>`
        select distinct on (u.id) u.id, e.setor from usuarios u join usuario_etapas ue on ue.usuario_id = u.id join etapas e on e.id = ue.etapa_id
        where e.ativo and e.setor in ${db(setores)} and u.ativo and u.papel in ('interno', 'admin') order by u.id, e.ordem`
    : [];
  const rotulo = [...setores.map((s) => `@${s}`), ...pessoas.map((p) => `@${p.nome}`)].join(", ") || null;
  const eventoId = await registrarEvento(db, { nota_id: notaId, tipo, usuario: u, texto, marcados: rotulo });
  const recebe = new Map<number, string | null>();
  for (const p of doSetor) recebe.set(p.id, p.setor);
  for (const p of pessoas) recebe.set(p.id, null); // marcado pelo nome: vale mais que pelo setor
  recebe.delete(u.id);
  for (const [usuarioId, setor] of recebe)
    await db`insert into mencoes (evento_id, nota_id, usuario_id, setor, autor_id, autor_nome) values (${eventoId}, ${notaId}, ${usuarioId}, ${setor}, ${u.id}, ${u.nome})
             on conflict do nothing`;
  return { eventoId, avisados: recebe.size, rotulo };
}

export type Aviso = {
  id: number; nota_id: number; numero: string; empresa: string; texto: string; marcados: string | null; setor: string | null;
  autor_id: number | null; autor_nome: string | null; criado_em: Date; lida_em: Date | null; etapa_nome: string | null; status: string;
};

const CAMPOS = sql`m.id, m.nota_id, n.numero, n.emit_nome as empresa, ev.texto, ev.marcados, m.setor, m.autor_id, m.autor_nome, m.criado_em, m.lida_em,
                   e.nome as etapa_nome, n.status`;

export async function avisosPendentes(u: Usuario, limite = 20) {
  const [itens, [t]] = await Promise.all([
    sql<Aviso[]>`select ${CAMPOS} from mencoes m join eventos ev on ev.id = m.evento_id join notas n on n.id = m.nota_id left join etapas e on e.id = n.etapa_id
                 where m.usuario_id = ${u.id} and m.lida_em is null order by m.criado_em desc limit ${limite}`,
    sql`select count(*)::int as n from mencoes where usuario_id = ${u.id} and lida_em is null`,
  ]);
  return { total: t.n as number, itens };
}

export async function mensagensRecebidas(u: Usuario, limite = 200) {
  return sql<Aviso[]>`select ${CAMPOS} from mencoes m join eventos ev on ev.id = m.evento_id join notas n on n.id = m.nota_id left join etapas e on e.id = n.etapa_id
                      where m.usuario_id = ${u.id} order by (m.lida_em is null) desc, m.criado_em desc limit ${limite}`;
}

/** Mensagens que o usuário enviou, com quantos já deram ciente. */
export async function mensagensEnviadas(u: Usuario, limite = 200) {
  return sql<{ evento_id: number; nota_id: number; numero: string; texto: string; marcados: string | null; criado_em: Date; total: number; cientes: number; pendentes: string | null }[]>`
    select ev.id as evento_id, ev.nota_id, n.numero, ev.texto, ev.marcados, ev.criado_em, count(m.id)::int as total, count(m.lida_em)::int as cientes,
           string_agg(case when m.lida_em is null then us.nome end, ', ' order by us.nome) as pendentes
    from eventos ev join notas n on n.id = ev.nota_id join mencoes m on m.evento_id = ev.id join usuarios us on us.id = m.usuario_id
    where ev.usuario_id = ${u.id} and ev.marcados is not null group by ev.id, n.numero order by ev.criado_em desc limit ${limite}`;
}

/** "Ciente": o aviso sai da lista do usuário e o ciente vai para o histórico da NF. */
export async function darCiente(u: Usuario, ids: number[]) {
  if (!ids.length) return 0;
  return sql.begin(async (tx) => {
    const lidas = await tx<{ nota_id: number; autor_nome: string | null; criado_em: Date }[]>`
      update mencoes set lida_em = now() where usuario_id = ${u.id} and lida_em is null and id in ${tx(ids.slice(0, 200))}
      returning nota_id, autor_nome, criado_em`;
    for (const l of lidas) {
      const quando = l.criado_em.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
      await registrarEvento(tx, { nota_id: l.nota_id, tipo: "ciente", usuario: u, texto: `Ciente da mensagem de ${l.autor_nome ?? "—"} (${quando})` });
    }
    return lidas.length;
  });
}

/** Ao responder numa NF, os avisos pendentes dessa NF ficam como lidos (a resposta já é o registro). */
export async function cienteAoResponder(db: Tx, u: Usuario, notaId: number) {
  await db`update mencoes set lida_em = now() where usuario_id = ${u.id} and nota_id = ${notaId} and lida_em is null`;
}
