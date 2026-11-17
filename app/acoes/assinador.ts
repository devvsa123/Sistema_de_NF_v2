"use server";

import { revalidatePath } from "next/cache";
import { exigirUsuario } from "@/lib/auth";
import { camposParaAssinar, concluirAssinatura, documentosParaAssinar, identificarCertificado, prepararAssinatura, prepararDocumento, type Alvo } from "@/lib/assinador";
import { obterNota } from "@/lib/notas";
import { etapasAtivas, etapasDoUsuario } from "@/lib/fluxo";

const doc = (d: string) => (d === "checklist" ? "checklist" : "tav");
const msg = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");

async function interno() {
  const u = await exigirUsuario();
  if (u.papel !== "admin" && u.papel !== "interno") throw new Error("Seu perfil não permite assinar documentos.");
  return u;
}

export async function acaoCamposAssinatura(registroId: number, d: string) {
  try {
    return { campos: await camposParaAssinar(await interno(), Number(registroId), doc(d)) };
  } catch (e) {
    return { erro: msg(e), campos: [] };
  }
}

export async function acaoPrepararAssinatura(registroId: number, d: string, campo: string) {
  try {
    return await prepararAssinatura(await interno(), Number(registroId), doc(d), String(campo));
  } catch (e) {
    return { erro: msg(e) };
  }
}

export async function acaoConcluirAssinatura(id: number, assinatura: string) {
  try {
    const r = await concluirAssinatura(await interno(), Number(id), String(assinatura));
    if (r.refazer) return { refazer: true };
    revalidatePath("/", "layout");
    return { ok: r.mensagem };
  } catch (e) {
    return { erro: msg(e) };
  }
}

export async function acaoIdentificarCertificado(assinatura: string) {
  try {
    const t = await identificarCertificado(await interno(), String(assinatura));
    return { nome: t.nome, cpf: t.cpf };
  } catch (e) {
    return { erro: msg(e) };
  }
}

export async function acaoDocumentosParaAssinar(notaId: number) {
  try {
    const u = await interno();
    if (!(await obterNota(u, Number(notaId)))) return { erro: "NF não encontrada.", docs: [] };
    const setores = u.papel === "admin" ? [] : [...new Set(etapasDoUsuario(u, await etapasAtivas()).map((e) => e.setor))];
    return { docs: await documentosParaAssinar(Number(notaId)), setores };
  } catch (e) {
    return { erro: msg(e), docs: [] };
  }
}

export async function acaoPrepararDocumento(documentoId: number, alvo: Alvo) {
  try {
    return await prepararDocumento(await interno(), Number(documentoId), alvo);
  } catch (e) {
    return { erro: msg(e) };
  }
}
