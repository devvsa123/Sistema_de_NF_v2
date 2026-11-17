"use server";

import { revalidatePath } from "next/cache";
import { exigirUsuario } from "@/lib/auth";
import { camposParaAssinar, concluirAssinatura, prepararAssinatura } from "@/lib/assinador";

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
    const m = await concluirAssinatura(await interno(), Number(id), String(assinatura));
    revalidatePath("/", "layout");
    return { ok: m };
  } catch (e) {
    return { erro: msg(e) };
  }
}
