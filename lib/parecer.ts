import "server-only";
import { sql } from "./db";
import type { Usuario } from "./auth";
import { etapasAtivas, etapasDoUsuario, executarAcao, registrarEvento } from "./fluxo";
import { DECISOES, type DecisaoEscolhida } from "./parecer-campos";
import { normalizar } from "./itens";

/** Decisões do parecer: quem pode decidir, registro no histórico e trâmite automático. */

const casa = (d: (typeof DECISOES)[string], texto: string) => d.palavras.some((p) => normalizar(texto).includes(normalizar(p)));

/** O usuário pode assinar este campo de decisão? (Enc. Técnica / Diretor, ou o administrador geral) */
export async function podeDecidir(u: Usuario, campo: string) {
  const d = DECISOES[campo];
  if (!d) return true;
  if (u.papel === "admin") return true;
  return etapasDoUsuario(u, await etapasAtivas()).some((e) => casa(d, `${e.setor} ${e.nome}`));
}

export type DecisaoGravada = DecisaoEscolhida & { campo: string };

/** Depois da assinatura: histórico, destaque de reprovação e movimentação da NF. Devolve um texto para quem assinou. */
export async function aplicarDecisao(u: Usuario, notaId: number, d: DecisaoGravada) {
  const def = DECISOES[d.campo];
  if (!def) return "";
  const opcao = def.opcoes[d.opcao] ?? "";
  const tecnica = d.campo === "Encarregado da Divisao Tecnica";
  const rotulo = tecnica ? "Parecer do Encarregado da Divisão Técnica" : "Resolução do Sr. Diretor";
  const texto = `${rotulo}: ${opcao}${d.observacao.trim() ? ` — ${d.observacao.trim()}` : ""}`;
  await registrarEvento(sql, { nota_id: notaId, tipo: "parecer", usuario: u, texto });

  const [n] = await sql`select n.status, n.etapa_id, coalesce(e.setor, '') || ' ' || coalesce(e.nome, '') as etapa from notas n left join etapas e on e.id = n.etapa_id where n.id = ${notaId}`;
  const naEtapa = n?.status === "em_tramite" && casa(def, n.etapa as string);
  try {
    if (tecnica) {
      if (opcao === "Reprovado") await sql`update notas set indicacao_reprovacao = coalesce(indicacao_reprovacao, 'tecnica') where id = ${notaId}`;
      if (!naEtapa) return ` ${opcao} registrado (a NF não está na etapa da Técnica, então não foi movimentada).`;
      await executarAcao(u, notaId, "avancar", { obs: texto });
      return ` ${opcao} registrado e a NF seguiu para a próxima etapa.`;
    }
    await sql`update notas set indicacao_reprovacao = null where id = ${notaId}`;
    if (!naEtapa) return ` ${opcao} registrado (a NF não está na etapa do Diretor, então não foi movimentada).`;
    if (opcao === "Não Arrecadar") {
      const [l] = await sql`select dados from laudos where nota_id = ${notaId} order by criado_em desc limit 1`;
      const f = (l?.dados as { formulario?: { resultado_visual?: string; resultado_laboratorial?: string } } | undefined)?.formulario ?? {};
      await executarAcao(u, notaId, "reprovar", {
        obs: texto,
        visual: f.resultado_visual === "Reprovado" ? "Sim" : "Não",
        laboratorial: f.resultado_laboratorial === "Reprovado" ? "Sim" : f.resultado_laboratorial === "Não se aplica" ? "Não ocorreu" : "Não",
      });
      return " Reprovação mantida: a NF foi para Reprovadas.";
    }
    await executarAcao(u, notaId, "avancar", { obs: texto });
    return ` ${opcao}: a NF seguiu para a próxima etapa.`;
  } catch (e) {
    return ` A decisão foi registrada, mas a NF não pôde ser movimentada: ${e instanceof Error ? e.message : "erro"}`;
  }
}
