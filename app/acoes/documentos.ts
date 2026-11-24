"use server";

import { revalidatePath } from "next/cache";
import { exigirAdmin, exigirUsuario } from "@/lib/auth";
import { sql } from "@/lib/db";
import { obterNota } from "@/lib/notas";
import { enviarDocumento, guardarParte, montarEnvio, removerDocumento, TAMANHO_MAX } from "@/lib/documentos";
import { testarArmazenamento } from "@/lib/arquivos";
import type { Estado } from "@/components/FormAcao";

const msg = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");

export async function acaoEnviarDocumento(_: Estado, f: FormData): Promise<Estado> {
  const u = await exigirUsuario();
  if (u.papel !== "admin" && u.papel !== "interno") return { erro: "Seu perfil não permite anexar documentos." };
  const nota = await obterNota(u, Number(f.get("id")));
  if (!nota) return { erro: "NF não encontrada." };
  const arquivos = f.getAll("arquivo").filter((a): a is File => a instanceof File && a.size > 0);
  if (!arquivos.length) return { erro: "Escolha o arquivo." };
  const feitos: string[] = [];
  try {
    for (const a of arquivos) {
      const r = await enviarDocumento(u, nota.id, Number(f.get("tipo")) || 0, a);
      const ok = r.assinaturas.filter((x) => x.integra);
      feitos.push(ok.length ? `${a.name}: assinado por ${[...new Set(ok.map((x) => x.nome))].join(", ")}` : `${a.name}: anexado`);
    }
  } catch (e) {
    revalidatePath(`/notas/${nota.id}`);
    return { erro: (feitos.length ? `${feitos.join(" · ")}. ` : "") + msg(e) };
  }
  revalidatePath(`/notas/${nota.id}`);
  revalidatePath("/");
  return { ok: feitos.join(" · ") };
}

export async function acaoRemoverDocumento(_: Estado, f: FormData): Promise<Estado> {
  const u = await exigirUsuario();
  try {
    const notaId = await removerDocumento(u, Number(f.get("doc")), String(f.get("motivo") ?? ""));
    revalidatePath(`/notas/${notaId}`);
    revalidatePath("/");
    return { ok: "Documento removido." };
  } catch (e) {
    return { erro: msg(e) };
  }
}

// ---------- administração

export async function acaoSalvarTipoDocumento(_: Estado, f: FormData): Promise<Estado> {
  await exigirAdmin();
  const id = Number(f.get("id")) || 0;
  const nome = String(f.get("nome") ?? "").trim().slice(0, 80);
  if (!nome) return { erro: "Informe o nome do tipo de documento." };
  const exige = f.get("exige_assinatura") === "on", ativo = f.get("ativo") === "on" || !id;
  const ordem = Math.max(0, Math.min(999, Number(f.get("ordem")) || 0));
  try {
    if (id) await sql`update tipos_documento set nome = ${nome}, exige_assinatura = ${exige}, ativo = ${ativo}, ordem = ${ordem} where id = ${id}`;
    else await sql`insert into tipos_documento (nome, exige_assinatura, ordem) values (${nome}, ${exige}, ${ordem || 50})`;
  } catch {
    return { erro: "Já existe um tipo de documento com esse nome." };
  }
  revalidatePath("/admin/documentos");
  return { ok: "Tipo de documento salvo." };
}

export async function acaoSalvarRegrasDocumentos(_: Estado, f: FormData): Promise<Estado> {
  await exigirAdmin();
  const pares = f.getAll("regra").map(String).map((v) => v.split(":").map(Number)).filter(([e, t]) => e > 0 && t > 0);
  await sql.begin(async (tx) => {
    await tx`delete from etapa_documentos`;
    for (const [etapa, tipo] of pares) await tx`insert into etapa_documentos (etapa_id, tipo_id) values (${etapa}, ${tipo}) on conflict do nothing`;
  });
  revalidatePath("/admin/documentos");
  revalidatePath("/", "layout");
  return { ok: "Documentos obrigatórios por etapa salvos." };
}

export async function acaoTestarArmazenamento(): Promise<Estado> {
  await exigirAdmin();
  try {
    return { ok: await testarArmazenamento() };
  } catch (e) {
    return { erro: msg(e) };
  }
}

/** Liga/desliga a exigência do pacote final para finalizar a NF. Somente o administrador geral. */
export async function acaoSalvarExigenciaPacote(_: Estado, f: FormData): Promise<Estado> {
  await exigirAdmin();
  const ligar = f.get("exigir") === "on";
  const { salvarExigenciaPacote } = await import("@/lib/pacote");
  await salvarExigenciaPacote(ligar);
  revalidatePath("/", "layout");
  return { ok: ligar ? "Exigência ligada: a NF só finaliza com o pacote final baixado e conferido." : "Exigência desligada: a NF finaliza como antes (o pacote continua disponível, opcional)." };
}

// ------------------------------------------------------------------ envio em partes (arquivos acima de ~3 MB)

async function podeAnexar(notaId: number) {
  const u = await exigirUsuario();
  if (u.papel !== "admin" && u.papel !== "interno") throw new Error("Seu perfil não permite anexar documentos.");
  const nota = await obterNota(u, notaId);
  if (!nota) throw new Error("NF não encontrada.");
  return { u, nota };
}

/** Recebe uma parte do arquivo (cada requisição fica abaixo do limite da Vercel). */
export async function acaoEnviarParte(f: FormData): Promise<{ erro?: string }> {
  try {
    const { u } = await podeAnexar(Number(f.get("nota")));
    const dados = f.get("dados");
    if (!(dados instanceof Blob)) return { erro: "Parte do arquivo não recebida." };
    await guardarParte(u, String(f.get("envio")), Number(f.get("parte")), new Uint8Array(await dados.arrayBuffer()));
    return {};
  } catch (e) {
    return { erro: msg(e) };
  }
}

/** Junta as partes, confere e anexa o documento à NF (mesmas regras do envio normal). */
export async function acaoConcluirEnvio(p: { envio: string; nota: number; tipo: number; nome: string; mime: string; total: number; tamanho: number }): Promise<{ erro?: string; ok?: string }> {
  try {
    const { u, nota } = await podeAnexar(Number(p.nota));
    if (!(p.tamanho > 0) || p.tamanho > TAMANHO_MAX) return { erro: `O arquivo tem ${(p.tamanho / 1048576).toFixed(1)} MB; o limite é ${TAMANHO_MAX / 1048576} MB.` };
    const bytes = await montarEnvio(u, String(p.envio), Number(p.total), Number(p.tamanho));
    const arquivo = new File([Buffer.from(bytes)], String(p.nome).slice(-200), { type: String(p.mime || "application/octet-stream") });
    const r = await enviarDocumento(u, nota.id, Number(p.tipo) || 0, arquivo);
    const ok = r.assinaturas.filter((x) => x.integra);
    revalidatePath(`/notas/${nota.id}`);
    revalidatePath("/");
    return { ok: ok.length ? `${p.nome}: assinado por ${[...new Set(ok.map((x) => x.nome))].join(", ")}` : `${p.nome}: anexado` };
  } catch (e) {
    return { erro: `${p.nome}: ${msg(e)}` };
  }
}
