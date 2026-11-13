"use server";

import { revalidatePath } from "next/cache";
import { exigirAdmin, exigirUsuario } from "@/lib/auth";
import { sql } from "@/lib/db";
import { obterNota } from "@/lib/notas";
import { definirIdPa, etapasAtivas, podeEditarIdPa, registrarEvento } from "@/lib/fluxo";
import {
  buscarNoEstoque, confirmarCorrelacao, desfazerCorrelacao, importarEstoque, importarUz, salvarConfigWms, sincronizarDoGithub,
} from "@/lib/estoque";
import type { Estado } from "@/components/FormAcao";

const msg = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");
const campo = (f: FormData, n: string) => String(f.get(n) ?? "").trim();

async function notaInterna(id: number) {
  const u = await exigirUsuario();
  if (u.papel !== "admin" && u.papel !== "interno") throw new Error("Seu perfil não permite esta ação.");
  const nota = await obterNota(u, id);
  if (!nota) throw new Error("NF não encontrada.");
  return { u, nota };
}

/** "3" → "item 3"; "3:40" → "item 3, tamanho 40". */
const rotuloItem = (ref: string) => {
  const [n, tam] = ref.split(":");
  return tam ? `item ${n}, tamanho ${tam},` : `item ${n}`;
};

export async function acaoConfirmarCorrelacao(_: Estado, f: FormData): Promise<Estado> {
  try {
    const { u, nota } = await notaInterna(Number(f.get("id")));
    const pi = campo(f, "pi") || campo(f, "pi_digitado");
    if (!pi) return { erro: "Escolha um item do estoque ou digite o PI." };
    await confirmarCorrelacao(u, nota, campo(f, "ref"), pi);
    await registrarEvento(sql, { nota_id: nota.id, tipo: "estoque", usuario: u, texto: `${rotuloItem(campo(f, "ref")).replace(/^i/, "I")} ligado ao PI ${pi.trim().toUpperCase()} do estoque` });
    revalidatePath(`/notas/${nota.id}`);
    return { ok: "Correlação confirmada. Vale também para as próximas NF deste fornecedor." };
  } catch (e) {
    return { erro: msg(e) };
  }
}

export async function acaoDesfazerCorrelacao(_: Estado, f: FormData): Promise<Estado> {
  try {
    const { u, nota } = await notaInterna(Number(f.get("id")));
    await desfazerCorrelacao(nota, campo(f, "ref"));
    await registrarEvento(sql, { nota_id: nota.id, tipo: "estoque", usuario: u, texto: `Correlação do ${rotuloItem(campo(f, "ref")).replace(/,$/, "")} com o estoque desfeita` });
    revalidatePath(`/notas/${nota.id}`);
    return { ok: "Correlação desfeita." };
  } catch (e) {
    return { erro: msg(e) };
  }
}

export async function acaoBuscarNoEstoque(q: string) {
  const u = await exigirUsuario();
  if (u.papel !== "admin" && u.papel !== "interno") return [];
  return buscarNoEstoque(String(q ?? "").slice(0, 80));
}

export async function acaoSalvarIdPa(_: Estado, f: FormData): Promise<Estado> {
  try {
    const { u, nota } = await notaInterna(Number(f.get("id")));
    if (!podeEditarIdPa(u, await etapasAtivas(), nota)) return { erro: "Você não pode alterar o ID de PA desta NF na etapa em que ela está." };
    const mudou = await sql.begin((tx) => definirIdPa(tx, u, nota.id, campo(f, "id_pa")));
    if (!mudou) return { ok: "Sem alteração." };
    revalidatePath("/");
    revalidatePath(`/notas/${nota.id}`);
    return { ok: "ID de PA salvo." };
  } catch (e) {
    return { erro: msg(e) };
  }
}

// ---------- administração

export async function acaoSincronizarGithub(): Promise<Estado> {
  await exigirAdmin();
  try {
    const r = await sincronizarDoGithub();
    revalidatePath("/", "layout");
    return { ok: `Estoque atualizado do GitHub: ${r.estoque.itens} itens (${r.estoque.linhas} linhas).${r.uz ? ` Alocação de UZ: ${r.uz.registros} registros.` : ""}` };
  } catch (e) {
    return { erro: msg(e) };
  }
}

export async function acaoEnviarEstoque(_: Estado, f: FormData): Promise<Estado> {
  await exigirAdmin();
  const arq = f.get("arquivo");
  if (!(arq instanceof File) || !arq.size) return { erro: "Escolha o arquivo controle-estoque.xlsx." };
  if (arq.size > 4 * 1024 * 1024) return { erro: "Arquivo maior que 4 MB." };
  try {
    const r = await importarEstoque(new Uint8Array(await arq.arrayBuffer()), `Envio manual: ${arq.name}`);
    revalidatePath("/", "layout");
    return { ok: `Estoque importado: ${r.itens} itens (${r.linhas} linhas).` };
  } catch (e) {
    return { erro: msg(e) };
  }
}

export async function acaoEnviarUz(_: Estado, f: FormData): Promise<Estado> {
  await exigirAdmin();
  const arq = f.get("arquivo");
  if (!(arq instanceof File) || !arq.size) return { erro: "Escolha a planilha de alocação das UZ." };
  if (arq.size > 4 * 1024 * 1024) return { erro: "Arquivo maior que 4 MB." };
  try {
    const r = await importarUz(new Uint8Array(await arq.arrayBuffer()), arq.name);
    revalidatePath("/", "layout");
    return { ok: `Alocação das UZ importada: ${r.registros} registros.` };
  } catch (e) {
    return { erro: msg(e) };
  }
}

export async function acaoSalvarConfigWms(_: Estado, f: FormData): Promise<Estado> {
  await exigirAdmin();
  const repo = campo(f, "planilhas_repo");
  if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) return { erro: "Repositório no formato dono/nome (ex.: DepfmrjAbastecimento/planilhas)." };
  const exigir = f.get("exigir_uz_alocadas") === "on";
  if (exigir && !campo(f, "planilha_uz")) return { erro: "Para exigir as UZ alocadas, informe o nome da planilha de alocação das UZ." };
  await salvarConfigWms({
    planilhas_repo: repo, planilhas_branch: campo(f, "planilhas_branch") || "main", planilha_estoque: campo(f, "planilha_estoque") || "dados_wms/controle-estoque.xlsx",
    planilha_uz: campo(f, "planilha_uz"), loc_virtual: (campo(f, "loc_virtual") || "REC").toUpperCase(), exigir_uz_alocadas: exigir ? "sim" : "nao",
  });
  revalidatePath("/", "layout");
  return { ok: "Configuração salva." };
}
