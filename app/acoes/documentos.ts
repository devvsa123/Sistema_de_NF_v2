"use server";

import { revalidatePath } from "next/cache";
import { exigirAdmin, exigirUsuario } from "@/lib/auth";
import { sql } from "@/lib/db";
import { obterNota } from "@/lib/notas";
import { enviarDocumento, removerDocumento } from "@/lib/documentos";
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
      const r = await enviarDocumento(u, nota.id, Number(f.get("tipo")), a);
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
