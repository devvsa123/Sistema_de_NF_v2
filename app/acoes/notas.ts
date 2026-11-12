"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { exigirUsuario, podeCadastrar } from "@/lib/auth";
import { ajustarComoAdmin, executarAcao, registrarEvento, type Acao, type OpcoesAcao } from "@/lib/fluxo";
import { analisarDocumento, cadastrarManual, cadastrarPorDocumento, obterNota, type Documento } from "@/lib/notas";
import { textoBusca } from "@/lib/nfe";
import { lerChave } from "@/lib/chave";
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

export async function acaoEditarNota(_: Estado, f: FormData): Promise<Estado> {
  const u = await exigirUsuario();
  if (!podeCadastrar(u)) return { erro: "Seu perfil não permite editar a NF." };
  const id = Number(f.get("id"));
  const oc = campo(f, "oc").slice(0, 60) || null;
  const [n] = await sql`select numero, chave, emit_nome, emit_cnpj, empenho, itens from notas where id = ${id}`;
  if (!n) return { erro: "NF não encontrada." };
  await sql`update notas set oc = ${oc}, obs_oc = ${campo(f, "obs_oc").slice(0, 2000) || null}, sob_medida = ${f.get("sob_medida") === "on"},
              busca = ${textoBusca({ ...(n as Parameters<typeof textoBusca>[0]), oc })} where id = ${id}`;
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

/** Lê a chave de acesso digitada e completa o que for possível: número, série, CNPJ e nome da empresa. */
export async function acaoConsultarChave(texto: string) {
  const u = await exigirUsuario();
  if (!podeCadastrar(u)) return { erro: "Seu perfil não permite cadastrar NF." };
  const r = lerChave(String(texto ?? ""));
  if (!r.ok) return { erro: r.erro };
  const chave = String(texto).replace(/\D/g, "");
  const [existente] = await sql`select id, numero from notas where chave = ${chave} limit 1`;
  const [empresa] = await sql`select nome from empresas where cnpj = ${r.dados.cnpj}`;
  const [ultima] = await sql`select oc from notas where emit_cnpj = ${r.dados.cnpj} and oc is not null order by recebida_em desc limit 1`;
  let nome: string | null = (empresa?.nome as string) ?? null;
  let origemNome = nome ? "cadastro do sistema" : "";
  if (!nome) {
    // empresa nova: consulta o nome no cadastro público de CNPJ (gratuito); se não responder, o nome é digitado
    try {
      const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${r.dados.cnpj}`, { signal: AbortSignal.timeout(5000), cache: "no-store" });
      if (resp.ok) {
        const j = (await resp.json()) as { razao_social?: string };
        if (j.razao_social) { nome = j.razao_social.toUpperCase(); origemNome = "cadastro público de CNPJ"; }
      }
    } catch {}
  }
  return {
    dados: { ...r.dados, nome, origemNome, ultimaOc: (ultima?.oc as string) ?? null },
    existente: existente ? { id: existente.id as number, numero: existente.numero as string } : null,
  };
}
