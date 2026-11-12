import "server-only";
import { sql, type Tx } from "./db";
import type { Usuario } from "./auth";

export type Etapa = {
  id: number;
  nome: string;
  ordem: number;
  prazo_dias: number;
  permite_reprovar: boolean;
  emite_laudo: boolean;
  setor: string;
  emite_docs_recebimento: boolean;
  exige_arrecadacao: boolean;
  faz_armazenagem: boolean;
  entrada_sob_medida: boolean;
  ativo: boolean;
};

export type Acao = "avancar" | "retornar" | "reprovar" | "retirar" | "reabrir" | "arrecadar" | "armazenar";

export const NOME_STATUS_FINAL: Record<string, string> = {
  finalizada: "Finalizada",
  reprovada: "Reprovada",
  retirada: "Retirada pelo fornecedor",
  arquivada: "Arquivada",
};

export async function etapasAtivas(db: Tx | typeof sql = sql): Promise<Etapa[]> {
  return db<Etapa[]>`select * from etapas where ativo order by ordem, id`;
}

/** Setores na ordem do caminho, com as etapas de cada um. */
export function setoresDe(etapas: Etapa[]) {
  const mapa = new Map<string, Etapa[]>();
  for (const e of etapas) mapa.set(e.setor, [...(mapa.get(e.setor) ?? []), e]);
  return [...mapa.entries()].map(([nome, lista]) => ({ nome, etapas: lista }));
}

export async function setorReprovadas(): Promise<string> {
  const [r] = await sql`select valor from config where chave = 'setor_reprovadas'`;
  return (r?.valor as string) ?? "";
}

export async function prazoReprovada(): Promise<number> {
  const [r] = await sql`select valor from config where chave = 'prazo_reprovada'`;
  return Number(r?.valor ?? 10);
}

/** Etapas em que o usuário atua (admin atua em todas). */
export function etapasDoUsuario(u: Usuario, etapas: Etapa[]) {
  if (u.papel === "admin") return etapas;
  if (u.papel !== "interno") return [];
  return etapas.filter((e) => u.etapas.includes(e.id));
}

export const podeArmazenar = (u: Usuario, etapas: Etapa[]) => etapasDoUsuario(u, etapas).some((e) => e.faz_armazenagem);
export const podeTratarReprovadas = (u: Usuario) => u.papel === "admin" || (u.papel === "interno" && u.trata_reprovadas);

type NotaMov = {
  id: number; numero: string; status: string; etapa_id: number | null; arrecadada_em: Date | null; armazenada_em: Date | null;
};

export type Vizinhos = { anterior: Etapa | null; proxima: Etapa | null; atual: Etapa | null };

/** Uma casa para trás e uma para frente no caminho definido pelo administrador. */
export function vizinhos(etapas: Etapa[], etapaId: number | null): Vizinhos {
  const i = etapas.findIndex((e) => e.id === etapaId);
  if (i < 0) return { anterior: null, proxima: null, atual: null };
  return { anterior: etapas[i - 1] ?? null, proxima: etapas[i + 1] ?? null, atual: etapas[i] };
}

/** Ações que o usuário pode executar agora sobre a NF. */
export function acoesPermitidas(u: Usuario, nota: NotaMov, etapas: Etapa[]): Acao[] {
  if (u.papel !== "admin" && u.papel !== "interno") return [];
  const minhas = etapasDoUsuario(u, etapas);
  const naMinhaEtapa = minhas.some((e) => e.id === nota.etapa_id);
  const { anterior, atual } = vizinhos(etapas, nota.etapa_id);
  const acoes: Acao[] = [];
  if (nota.status === "em_tramite" && naMinhaEtapa && atual) {
    if (!atual.exige_arrecadacao || nota.arrecadada_em) acoes.push("avancar");
    if (atual.exige_arrecadacao && !nota.arrecadada_em) acoes.push("arrecadar");
    if (anterior) acoes.push("retornar");
    if (atual.permite_reprovar) acoes.push("reprovar");
  }
  if (nota.status === "reprovada" && (podeTratarReprovadas(u) || naMinhaEtapa)) acoes.push("retirar", "reabrir");
  if (nota.arrecadada_em && !nota.armazenada_em && podeArmazenar(u, etapas)) acoes.push("armazenar");
  return acoes;
}

export async function registrarEvento(
  db: Tx | typeof sql,
  e: {
    nota_id: number; tipo: string; movimento?: boolean; de_nome?: string | null; para_etapa_id?: number | null;
    para_status?: string | null; para_nome?: string | null; usuario?: Usuario | null; usuario_nome?: string | null;
    texto?: string | null; criado_em?: Date | null;
  },
) {
  await db`insert into eventos (nota_id, tipo, movimento, de_nome, para_etapa_id, para_status, para_nome, usuario_id, usuario_nome, texto, criado_em)
           values (${e.nota_id}, ${e.tipo}, ${e.movimento ?? false}, ${e.de_nome ?? null}, ${e.para_etapa_id ?? null}, ${e.para_status ?? null},
                   ${e.para_nome ?? null}, ${e.usuario?.id ?? null}, ${e.usuario?.nome ?? e.usuario_nome ?? null}, ${e.texto?.trim() || null},
                   coalesce(${e.criado_em ?? null}::timestamptz, now()))`;
}

export type OpcoesAcao = { obs?: string; visual?: string; laboratorial?: string };

/** Executa uma ação de tramitação em uma NF, validando perfil e caminho dentro de uma transação. */
export async function executarAcao(u: Usuario, notaId: number, acao: Acao, op: OpcoesAcao = {}): Promise<void> {
  await sql.begin(async (tx) => {
    const [nota] = await tx<NotaMov[]>`select id, numero, status, etapa_id, arrecadada_em, armazenada_em from notas where id = ${notaId} for update`;
    if (!nota) throw new Error("NF não encontrada.");
    const etapas = await etapasAtivas(tx);
    if (!acoesPermitidas(u, nota, etapas).includes(acao)) {
      const { atual } = vizinhos(etapas, nota.etapa_id);
      if (acao === "avancar" && atual?.exige_arrecadacao && !nota.arrecadada_em)
        throw new Error(`NF ${nota.numero}: precisa ser arrecadada antes de avançar.`);
      throw new Error(`NF ${nota.numero}: ação não permitida para o seu perfil ou a NF já foi movimentada por outro usuário.`);
    }
    const { anterior, proxima, atual } = vizinhos(etapas, nota.etapa_id);
    const de = nota.status === "reprovada" ? "Reprovada" : atual!.nome;
    const base = { nota_id: nota.id, usuario: u, de_nome: de, texto: op.obs };

    switch (acao) {
      case "avancar":
        if (proxima) {
          await tx`update notas set etapa_id = ${proxima.id}, etapa_desde = now() where id = ${nota.id}`;
          await registrarEvento(tx, { ...base, tipo: "avanco", movimento: true, para_etapa_id: proxima.id, para_status: "em_tramite", para_nome: proxima.nome });
        } else {
          await tx`update notas set status = 'finalizada', etapa_desde = now(), concluida_em = now() where id = ${nota.id}`;
          await registrarEvento(tx, { ...base, tipo: "finalizacao", movimento: true, para_status: "finalizada", para_nome: "Finalizada" });
        }
        break;
      case "retornar":
        await tx`update notas set etapa_id = ${anterior!.id}, etapa_desde = now() where id = ${nota.id}`;
        await registrarEvento(tx, { ...base, tipo: "retorno", movimento: true, para_etapa_id: anterior!.id, para_status: "em_tramite", para_nome: anterior!.nome });
        break;
      case "reprovar": {
        if (!op.obs?.trim()) throw new Error("Informe o motivo da reprovação.");
        await tx`update notas set status = 'reprovada', etapa_desde = now(), reprov_visual = ${op.visual || null}, reprov_laboratorial = ${op.laboratorial || null} where id = ${nota.id}`;
        const detalhe = [op.visual && `Perícia visual: ${op.visual}`, op.laboratorial && `Perícia laboratorial: ${op.laboratorial}`, op.obs].filter(Boolean).join(" · ");
        await registrarEvento(tx, { ...base, tipo: "reprovacao", movimento: true, para_etapa_id: nota.etapa_id, para_status: "reprovada", para_nome: "Reprovada", texto: detalhe });
        break;
      }
      case "retirar":
        await tx`update notas set status = 'retirada', etapa_desde = now(), concluida_em = now() where id = ${nota.id}`;
        await registrarEvento(tx, { ...base, tipo: "retirada", movimento: true, para_status: "retirada", para_nome: NOME_STATUS_FINAL.retirada });
        break;
      case "reabrir":
        await tx`update notas set status = 'em_tramite', etapa_desde = now(), reprov_visual = null, reprov_laboratorial = null where id = ${nota.id}`;
        await registrarEvento(tx, { ...base, tipo: "retorno", movimento: true, para_etapa_id: nota.etapa_id, para_status: "em_tramite", para_nome: atual!.nome });
        break;
      case "arrecadar":
        await tx`update notas set arrecadada_em = now() where id = ${nota.id}`;
        await registrarEvento(tx, { ...base, de_nome: null, tipo: "arrecadacao", texto: op.obs });
        break;
      case "armazenar":
        await tx`update notas set armazenada_em = now() where id = ${nota.id}`;
        await registrarEvento(tx, { ...base, de_nome: null, tipo: "armazenagem", texto: op.obs });
        break;
    }
  });
}

/** Correção feita pelo administrador: coloca a NF em qualquer etapa ou situação. */
export async function ajustarComoAdmin(u: Usuario, notaId: number, destino: string, motivo: string) {
  if (u.papel !== "admin") throw new Error("Apenas o administrador pode fazer ajustes.");
  if (!motivo.trim()) throw new Error("Informe o motivo do ajuste.");
  await sql.begin(async (tx) => {
    const [nota] = await tx`select n.id, n.status, n.etapa_id, e.nome as etapa_nome from notas n left join etapas e on e.id = n.etapa_id where n.id = ${notaId} for update of n`;
    if (!nota) throw new Error("NF não encontrada.");
    const de = nota.status === "em_tramite" ? nota.etapa_nome : NOME_STATUS_FINAL[nota.status];
    if (destino.startsWith("etapa:")) {
      const [etapa] = await tx<Etapa[]>`select * from etapas where id = ${Number(destino.slice(6))} and ativo`;
      if (!etapa) throw new Error("Etapa inválida.");
      await tx`update notas set status = 'em_tramite', etapa_id = ${etapa.id}, etapa_desde = now(), concluida_em = null where id = ${notaId}`;
      await registrarEvento(tx, { nota_id: notaId, tipo: "ajuste", movimento: true, de_nome: de, para_etapa_id: etapa.id, para_status: "em_tramite", para_nome: etapa.nome, usuario: u, texto: motivo });
    } else if (["finalizada", "retirada", "arquivada"].includes(destino)) {
      await tx`update notas set status = ${destino}, etapa_desde = now(), concluida_em = now() where id = ${notaId}`;
      await registrarEvento(tx, { nota_id: notaId, tipo: "ajuste", movimento: true, de_nome: de, para_status: destino, para_nome: NOME_STATUS_FINAL[destino], usuario: u, texto: motivo });
    } else throw new Error("Destino inválido.");
  });
}
