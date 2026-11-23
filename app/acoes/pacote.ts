"use server";

import { revalidatePath } from "next/cache";
import { exigirUsuario } from "@/lib/auth";
import { etapasAtivas, etapasDoUsuario, vizinhos } from "@/lib/fluxo";
import { obterNota } from "@/lib/notas";
import { confirmarPacote, verificarPacote } from "@/lib/pacote";

const msg = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");

/** Quem trabalha na última etapa (Controle — Finalização) com a NF nela, ou o administrador geral. */
async function permitido(id: number) {
  const u = await exigirUsuario();
  const nota = await obterNota(u, id);
  if (!nota) throw new Error("NF não encontrada.");
  const etapas = await etapasAtivas();
  const { atual, proxima } = vizinhos(etapas, nota.etapa_id);
  if (nota.status !== "em_tramite" || !atual || proxima) throw new Error("O pacote final é feito quando a NF está na última etapa do trâmite.");
  if (u.papel !== "admin" && !etapasDoUsuario(u, etapas).some((e) => e.id === atual.id)) throw new Error(`Somente quem atua em ${atual.nome} faz o pacote final.`);
  return u;
}

export async function acaoVerificarPacote(notaId: number) {
  try {
    await permitido(Number(notaId));
    return await verificarPacote(Number(notaId));
  } catch (e) {
    return { erro: msg(e) };
  }
}

export async function acaoConfirmarPacote(notaId: number, recebidos: { id: number; sha256: string }[], historicoSha: string) {
  try {
    const u = await permitido(Number(notaId));
    const lista = (Array.isArray(recebidos) ? recebidos : []).slice(0, 500).map((r) => ({ id: Number(r.id), sha256: String(r.sha256).toLowerCase() }));
    await confirmarPacote(u, Number(notaId), lista, String(historicoSha ?? ""));
    revalidatePath(`/notas/${notaId}`);
    return { ok: true };
  } catch (e) {
    return { erro: msg(e) };
  }
}
