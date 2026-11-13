"use server";

import { revalidatePath } from "next/cache";
import { exigirUsuario } from "@/lib/auth";
import { avisosPendentes, darCiente, destinatarios, type Destinatarios } from "@/lib/mencoes";

const operador = (papel: string) => papel === "admin" || papel === "interno";

export type AvisoTela = {
  id: number; notaId: number; numero: string; empresa: string; texto: string; marcados: string | null; setor: string | null;
  autorId: number | null; autor: string; em: string; etapa: string;
};

/** Avisos ainda sem "ciente" do usuário logado (consultado a cada poucos segundos pela tela). */
export async function acaoAvisos(): Promise<{ total: number; itens: AvisoTela[] }> {
  const u = await exigirUsuario();
  if (!operador(u.papel)) return { total: 0, itens: [] };
  const { total, itens } = await avisosPendentes(u, 20);
  return {
    total,
    itens: itens.map((a) => ({
      id: a.id, notaId: a.nota_id, numero: a.numero, empresa: a.empresa, texto: a.texto, marcados: a.marcados, setor: a.setor,
      autorId: a.autor_id, autor: a.autor_nome ?? "—", em: a.criado_em.toISOString(),
      etapa: a.status === "em_tramite" ? (a.etapa_nome ?? "—") : a.status === "reprovada" ? "Reprovada" : "Concluída",
    })),
  };
}

export async function acaoCiente(ids: number[]) {
  const u = await exigirUsuario();
  const n = await darCiente(u, (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger));
  revalidatePath("/", "layout");
  return n;
}

export async function acaoDestinatarios(): Promise<Destinatarios> {
  const u = await exigirUsuario();
  if (!operador(u.papel)) return { setores: [], usuarios: [] };
  const d = await destinatarios();
  return { ...d, usuarios: d.usuarios.filter((x) => x.id !== u.id) };
}
