"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { exigirUsuario, podeCadastrar } from "@/lib/auth";
import { ajustarComoAdmin, definirIdPa, etapasAtivas, executarAcao, podeEditarIdPa, registrarEvento, type Acao, type OpcoesAcao } from "@/lib/fluxo";
import { analisarDocumento, cadastrarManual, cadastrarPorDocumento, obterNota, type Documento } from "@/lib/notas";
import { textoBusca } from "@/lib/nfe";
import { TIPO_EVENTO } from "@/lib/format";
import type { Estado } from "@/components/FormAcao";

const ACOES: Acao[] = ["avancar", "retornar", "reprovar", "retirar", "reabrir", "arrecadar", "armazenar"];
const msg = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");
const campo = (f: FormData, nome: string) => String(f.get(nome) ?? "").trim();

/** Tramita uma ou várias NF de uma vez. Cada NF é validada individualmente. */
export async function acaoTramitar(ids: number[], acao: Acao, op: OpcoesAcao = {}) {
  const u = await exigirUsuario();
  if (!ACOES.includes(acao) || !Array.isArray(ids) || ids.length === 0 || ids.length > 200) return { feitas: 0, erros: ["Requisição inválida."] };
  const opcoes = { obs: String(op.obs ?? "").slice(0, 2000), visual: String(op.visual ?? "").slice(0, 30), laboratorial: String(op.laboratorial ?? "").slice(0, 30) };
  let feitas = 0;
  const erros: string[] = [];
  for (const id of ids) {
    try {
      await executarAcao(u, Number(id), acao, opcoes);
      feitas++;
    } catch (e) {
      erros.push(msg(e));
    }
  }
  revalidatePath("/", "layout");
  return { feitas, erros };
}

export async function acaoObservacao(_: Estado, f: FormData): Promise<Estado> {
  const u = await exigirUsuario();
  if (u.papel !== "admin" && u.papel !== "interno") return { erro: "Seu perfil não permite registrar observações." };
  const id = Number(f.get("id"));
  const texto = campo(f, "texto").slice(0, 2000);
  if (!texto) return { erro: "Escreva a observação." };
  if (!(await obterNota(u, id))) return { erro: "NF não encontrada." };
  await registrarEvento(sql, { nota_id: id, tipo: "observacao", usuario: u, texto });
  revalidatePath(`/notas/${id}`);
  return { ok: "Observação registrada." };
}

/** ID de PA informado direto na fila. */
export async function acaoIdPaFila(id: number, valor: string): Promise<{ erro?: string; idPa?: string | null }> {
  const u = await exigirUsuario();
  const nota = await obterNota(u, Number(id));
  if (!nota) return { erro: "NF não encontrada." };
  if (!podeEditarIdPa(u, await etapasAtivas(), nota)) return { erro: "Você não pode alterar o ID de PA desta NF na etapa em que ela está." };
  try {
    await sql.begin((tx) => definirIdPa(tx, u, nota.id, valor));
  } catch (e) {
    return { erro: msg(e) };
  }
  revalidatePath("/");
  revalidatePath(`/notas/${nota.id}`);
  const v = String(valor ?? "").trim().slice(0, 30);
  return { idPa: v || null };
}

export type Comentario = { id: number; tipo: string; titulo: string; usuario: string; texto: string; em: string };

/** Todos os comentários (registros com texto) do histórico da NF, do mais recente para o mais antigo. */
export async function acaoComentarios(id: number): Promise<{ erro?: string; numero?: string; obsOc?: string; itens: Comentario[] }> {
  const u = await exigirUsuario();
  if (u.papel !== "admin" && u.papel !== "interno") return { erro: "Seu perfil não permite ver os comentários.", itens: [] };
  const nota = await obterNota(u, Number(id));
  if (!nota) return { erro: "NF não encontrada.", itens: [] };
  const linhas = await sql`select id, tipo, movimento, de_nome, para_nome, usuario_nome, texto, criado_em from eventos
                           where nota_id = ${nota.id} and texto is not null and btrim(texto) <> '' order by criado_em desc, id desc limit 500`;
  return {
    numero: nota.numero, obsOc: nota.obs_oc ?? undefined,
    itens: linhas.map((e) => ({
      id: e.id as number, tipo: e.tipo as string, texto: e.texto as string, usuario: (e.usuario_nome as string | null) ?? "—",
      titulo: e.movimento && e.de_nome ? `${e.de_nome} → ${e.para_nome}` : (TIPO_EVENTO[e.tipo as string] ?? (e.tipo as string)),
      em: (e.criado_em as Date).toISOString(),
    })),
  };
}

/** Registra uma observação direto da fila e devolve a lista atualizada. */
export async function acaoComentar(id: number, texto: string) {
  const u = await exigirUsuario();
  if (u.papel !== "admin" && u.papel !== "interno") return { erro: "Seu perfil não permite registrar observações.", itens: [] as Comentario[] };
  const t = String(texto ?? "").trim().slice(0, 2000);
  if (!t) return { erro: "Escreva a observação.", itens: [] as Comentario[] };
  const nota = await obterNota(u, Number(id));
  if (!nota) return { erro: "NF não encontrada.", itens: [] as Comentario[] };
  await registrarEvento(sql, { nota_id: nota.id, tipo: "observacao", usuario: u, texto: t });
  revalidatePath("/");
  revalidatePath(`/notas/${nota.id}`);
  return acaoComentarios(nota.id);
}

export async function acaoEditarNota(_: Estado, f: FormData): Promise<Estado> {
  const u = await exigirUsuario();
  if (!podeCadastrar(u)) return { erro: "Seu perfil não permite editar a NF." };
  const id = Number(f.get("id"));
  const oc = campo(f, "oc").slice(0, 60) || null;
  if (!oc) return { erro: "A OC não pode ficar em branco." };
  const [n] = await sql`select numero, chave, emit_nome, emit_cnpj, empenho, itens, oc, obs_oc, sob_medida from notas where id = ${id}`;
  if (!n) return { erro: "NF não encontrada." };
  const obsOc = campo(f, "obs_oc").slice(0, 2000) || null;
  const sobMedida = f.get("sob_medida") === "on";
  const mudou = [
    n.oc !== oc && `OC: ${n.oc ?? "—"} → ${oc}`,
    !!n.sob_medida !== sobMedida && `Sob medida: ${n.sob_medida ? "sim" : "não"} → ${sobMedida ? "sim" : "não"}`,
    (n.obs_oc ?? null) !== obsOc && (obsOc ? `Observação da OC: ${obsOc}` : "Observação da OC removida"),
  ].filter(Boolean) as string[];
  if (!mudou.length) return { ok: "Nada foi alterado." };
  await sql.begin(async (tx) => {
    await tx`update notas set oc = ${oc}, obs_oc = ${obsOc}, sob_medida = ${sobMedida},
               busca = ${textoBusca({ ...(n as Parameters<typeof textoBusca>[0]), oc })} where id = ${id}`;
    await registrarEvento(tx, { nota_id: id, tipo: "edicao", usuario: u, texto: mudou.join("\n") });
  });
  revalidatePath(`/notas/${id}`);
  return { ok: "Dados atualizados." };
}

export async function acaoAjusteAdmin(_: Estado, f: FormData): Promise<Estado> {
  const u = await exigirUsuario();
  const id = Number(f.get("id"));
  try {
    await ajustarComoAdmin(u, id, campo(f, "destino"), campo(f, "motivo"));
  } catch (e) {
    return { erro: msg(e) };
  }
  revalidatePath("/", "layout");
  return { ok: "NF ajustada." };
}

const LIMITE_DOC = 2.9 * 1024 * 1024;
function documento(tipo: string, conteudo: string): Documento {
  if ((tipo !== "xml" && tipo !== "pdf") || typeof conteudo !== "string" || !conteudo || conteudo.length > LIMITE_DOC) throw new Error("Arquivo inválido ou maior que 2 MB.");
  return { tipo, conteudo };
}

export async function acaoAnalisarDocumento(tipo: string, conteudo: string) {
  const u = await exigirUsuario();
  if (!podeCadastrar(u)) return { erro: "Seu perfil não permite cadastrar NF." };
  try {
    const { nf, existente, bloqueio } = await analisarDocumento(documento(tipo, conteudo));
    return {
      previa: {
        chave: nf.chave, numero: nf.numero, serie: nf.serie, emit_cnpj: nf.emit_cnpj, emit_nome: nf.emit_nome, valor: nf.valor,
        data_emissao: nf.data_emissao, oc: nf.oc, empenho: nf.empenho, itens: nf.itens.length, existente, bloqueio,
      },
    };
  } catch (e) {
    return { erro: msg(e) };
  }
}

export async function acaoCadastrarDocumento(tipo: string, conteudo: string, op: { oc?: string; sobMedida?: boolean; obs?: string }) {
  const u = await exigirUsuario();
  try {
    const r = await cadastrarPorDocumento(u, documento(tipo, conteudo), { oc: String(op.oc ?? "").slice(0, 60), sobMedida: !!op.sobMedida, obs: String(op.obs ?? "").slice(0, 2000) });
    revalidatePath("/", "layout");
    return { ok: r };
  } catch (e) {
    return { erro: msg(e) };
  }
}

export async function acaoCadastrarManual(_: Estado, f: FormData): Promise<Estado> {
  const u = await exigirUsuario();
  let id: number;
  try {
    const valor = Number(campo(f, "valor").replace(/\./g, "").replace(",", "."));
    id = await cadastrarManual(u, {
      chave: campo(f, "chave"), numero: campo(f, "numero"), cnpj: campo(f, "cnpj"), nome: campo(f, "nome"),
      valor, oc: campo(f, "oc"), sobMedida: f.get("sob_medida") === "on", obs: campo(f, "obs"),
    });
  } catch (e) {
    return { erro: msg(e) };
  }
  revalidatePath("/", "layout");
  redirect(`/notas/${id}`);
}
