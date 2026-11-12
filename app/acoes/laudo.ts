"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirAdmin, exigirUsuario } from "@/lib/auth";
import { etapasAtivas } from "@/lib/fluxo";
import { obterNota } from "@/lib/notas";
import {
  analisarModelo, camposFixos, CHAVE_VALIDA, emitirLaudo, podeEmitirLaudo, restaurarModeloPadrao, salvarCamposFixos, salvarModelo, validarDados,
  type CampoFixo, type DadosLaudo,
} from "@/lib/laudo";
import type { Estado } from "@/components/FormAcao";

const campo = (f: FormData, nome: string) => String(f.get(nome) ?? "").slice(0, 2000);
const msg = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");

export async function acaoEmitirLaudo(_: Estado, f: FormData): Promise<Estado> {
  const u = await exigirUsuario();
  if (!podeEmitirLaudo(u, await etapasAtivas())) return { erro: "Somente os usuários da Perícia emitem laudos." };
  const id = Number(f.get("id"));
  if (!(await obterNota(u, id))) return { erro: "NF não encontrada." };
  const d: DadosLaudo = {
    protocolo: campo(f, "protocolo"), lote: campo(f, "lote"), fabricacao: campo(f, "fabricacao"), resultado_visual: campo(f, "resultado_visual"),
    medidas: campo(f, "medidas"), medidas_explicacao: campo(f, "medidas_explicacao"), obs_visual: campo(f, "obs_visual"),
    resultado_laboratorial: campo(f, "resultado_laboratorial"), numero_oficio: campo(f, "numero_oficio"), data_envio: campo(f, "data_envio"),
    data_recebimento: campo(f, "data_recebimento"), obs_laboratorial: campo(f, "obs_laboratorial"),
  };
  const erro = validarDados(d);
  if (erro) return { erro };
  let laudo: number;
  try {
    laudo = await emitirLaudo(u, id, d);
  } catch (e) {
    return { erro: msg(e) };
  }
  revalidatePath(`/notas/${id}`);
  redirect(`/notas/${id}/laudo?emitido=${laudo}`);
}

export async function acaoSalvarCamposFixos(_: Estado, f: FormData): Promise<Estado> {
  await exigirAdmin();
  const chaves = f.getAll("chave").map(String), rotulos = f.getAll("rotulo").map(String), valores = f.getAll("valor").map(String);
  const remover = new Set(f.getAll("remover").map(String));
  const lista: CampoFixo[] = chaves
    .map((c, i) => ({ chave: c.trim().toLowerCase(), rotulo: (rotulos[i] ?? "").trim().slice(0, 80), valor: (valores[i] ?? "").slice(0, 500) }))
    .filter((c) => c.chave && !remover.has(c.chave));
  const nova = { chave: campo(f, "nova_chave").trim().toLowerCase(), rotulo: campo(f, "nova_rotulo").trim().slice(0, 80), valor: campo(f, "nova_valor").slice(0, 500) };
  if (nova.chave) {
    if (!CHAVE_VALIDA.test(nova.chave)) return { erro: "Marcador inválido. Use letras minúsculas, números e _ (ex.: encarregado_nome)." };
    lista.push({ ...nova, rotulo: nova.rotulo || nova.chave });
  }
  try {
    await salvarCamposFixos(lista);
  } catch (e) {
    return { erro: msg(e) };
  }
  revalidatePath("/admin/laudo");
  return { ok: "Campos fixos salvos. Os próximos laudos já saem com os novos valores." };
}

export async function acaoEnviarModelo(_: Estado, f: FormData): Promise<Estado> {
  const u = await exigirAdmin();
  const arq = f.get("arquivo");
  if (!(arq instanceof File) || !arq.size) return { erro: "Escolha o arquivo .docx do modelo." };
  if (!/\.docx$/i.test(arq.name)) return { erro: "O modelo precisa ser um arquivo do Word (.docx). Se estiver em .doc, salve como .docx." };
  if (arq.size > 2 * 1024 * 1024) return { erro: "O modelo tem mais de 2 MB." };
  const bytes = new Uint8Array(await arq.arrayBuffer());
  try {
    const { achados, desconhecidos } = analisarModelo(bytes, await camposFixos());
    await salvarModelo(u, bytes, arq.name);
    revalidatePath("/admin/laudo");
    const aviso = desconhecidos.length ? ` Atenção: estes marcadores não são conhecidos e sairão em branco no laudo: ${desconhecidos.join(", ")}.` : "";
    return { ok: `Modelo atualizado (${achados.length} marcadores encontrados).${aviso}` };
  } catch (e) {
    return { erro: msg(e) };
  }
}

export async function acaoRestaurarModelo(): Promise<Estado> {
  const u = await exigirAdmin();
  await restaurarModeloPadrao(u);
  revalidatePath("/admin/laudo");
  return { ok: "Modelo padrão restaurado." };
}
