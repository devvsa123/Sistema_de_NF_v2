"use server";

import { exigirUsuario } from "@/lib/auth";
import { criarSessao, situacaoSessao } from "@/lib/assinador";

export async function acaoIniciarAssinatura(registroId: number, doc: "tav" | "checklist") {
  const u = await exigirUsuario();
  if (u.papel !== "admin" && u.papel !== "interno") return { erro: "Seu perfil não permite assinar documentos." };
  try {
    return await criarSessao(u, Number(registroId), doc === "checklist" ? "checklist" : "tav");
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Erro." };
  }
}

export async function acaoSituacaoAssinatura(id: number) {
  const u = await exigirUsuario();
  return situacaoSessao(u, Number(id));
}
