"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { etapasAtivas } from "@/lib/fluxo";
import { obterNota } from "@/lib/notas";
import { emitirDocRecebimento, PERGUNTAS_TAV, podeEmitirRecebimento, validarChecklist, validarTav, type DadosRecebimento } from "@/lib/recebimento";
import type { Estado } from "@/components/FormAcao";

const campo = (f: FormData, nome: string) => String(f.get(nome) ?? "").slice(0, 1000);

export async function acaoEmitirRecebimento(_: Estado, f: FormData): Promise<Estado> {
  const u = await exigirUsuario();
  const id = Number(f.get("id"));
  const nota = await obterNota(u, id);
  if (!nota) return { erro: "NF não encontrada." };
  if (!podeEmitirRecebimento(u, await etapasAtivas(), nota))
    return { erro: "Os documentos do Recebimento só podem ser emitidos pelo Recebimento enquanto a NF estiver em Pré Recebimento ou Contagem." };
  const d: DadosRecebimento = {
    numero_tav: campo(f, "numero_tav"), data_recebimento: campo(f, "data_recebimento"), id_pa: campo(f, "id_pa"), lote: campo(f, "lote"),
    fabricacao: campo(f, "fabricacao"), volumes: campo(f, "volumes"), conferencia: campo(f, "conferencia"),
    respostas: PERGUNTAS_TAV.map((_, i) => campo(f, `q${i + 1}`)), observacao: campo(f, "observacao"),
    peso_kg: campo(f, "peso_kg"), itens_caixa: campo(f, "itens_caixa"), data_envio_amostra: campo(f, "data_envio_amostra"),
    obs_recebimento: campo(f, "obs_recebimento"), discrepancia: campo(f, "discrepancia"), obs_contagem: campo(f, "obs_contagem"),
  };
  const doc = campo(f, "doc") === "checklist" ? "checklist" : "tav";
  const erro = doc === "tav" ? validarTav(d) : validarChecklist(d);
  if (erro) return { erro };
  let reg: number;
  try {
    reg = await emitirDocRecebimento(u, id, doc, d);
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Erro inesperado." };
  }
  revalidatePath(`/notas/${id}`);
  redirect(`/notas/${id}/recebimento?emitido=${reg}&doc=${doc}`);
}
