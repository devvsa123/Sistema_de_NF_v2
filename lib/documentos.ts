import "server-only";
import { sql, type Tx } from "./db";
import type { Usuario } from "./auth";
import { registrarEvento } from "./fluxo";
import { guardar, ler } from "./arquivos";
import { assinaturasDoPdf, sha256, type Assinatura } from "./assinatura";

/** Documentos da NF: envio, conferência das assinaturas, download e regras de tramitação. */

export const TAMANHO_MAX = 4 * 1024 * 1024; // limite de envio pela Vercel (~4,5 MB por requisição)
const TIPOS_ARQUIVO: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", xml: "application/xml" };

export type TipoDocumento = { id: number; nome: string; exige_assinatura: boolean; ordem: number; ativo: boolean };
export type Documento = {
  id: number; nota_id: number; tipo_id: number; tipo: string; exige_assinatura: boolean; nome_arquivo: string; mime: string; tamanho: number;
  assinaturas: Assinatura[]; enviado_por: number | null; enviado_por_nome: string | null; criado_em: Date;
};

export async function tiposDocumento(todos = false) {
  return sql<TipoDocumento[]>`select * from tipos_documento ${todos ? sql`` : sql`where ativo`} order by ordem, nome`;
}

/** Um documento conta como entregue quando não exige assinatura ou tem ao menos uma assinatura íntegra. */
export const valido = (d: { exige_assinatura: boolean; assinaturas: Assinatura[] }) => !d.exige_assinatura || d.assinaturas.some((a) => a.integra);

export async function documentosDaNota(notaId: number) {
  return sql<Documento[]>`
    select d.id, d.nota_id, d.tipo_id, t.nome as tipo, t.exige_assinatura, d.nome_arquivo, d.mime, d.tamanho, d.assinaturas,
           d.enviado_por, d.enviado_por_nome, d.criado_em
    from documentos d join tipos_documento t on t.id = d.tipo_id
    where d.nota_id = ${notaId} and d.removido_em is null order by t.ordem, d.criado_em`;
}

/** Tipos obrigatórios para a NF sair da etapa e quais ainda faltam. */
export async function pendencias(db: Tx | typeof sql, notaId: number, etapaId: number | null) {
  if (!etapaId) return { exigidos: [] as TipoDocumento[], faltando: [] as TipoDocumento[] };
  const exigidos = await db<TipoDocumento[]>`select t.* from etapa_documentos ed join tipos_documento t on t.id = ed.tipo_id
                                              where ed.etapa_id = ${etapaId} and t.ativo order by t.ordem`;
  if (!exigidos.length) return { exigidos, faltando: [] };
  const docs = await db<{ tipo_id: number; exige_assinatura: boolean; assinaturas: Assinatura[] }[]>`
    select d.tipo_id, t.exige_assinatura, d.assinaturas from documentos d join tipos_documento t on t.id = d.tipo_id
    where d.nota_id = ${notaId} and d.removido_em is null`;
  const ok = new Set(docs.filter(valido).map((d) => d.tipo_id));
  return { exigidos, faltando: exigidos.filter((t) => !ok.has(t.id)) };
}

function extensao(nome: string) {
  return (nome.split(".").pop() ?? "").toLowerCase();
}

const resumoAssinaturas = (a: Assinatura[]) =>
  a.length ? ` — assinado por ${[...new Set(a.filter((x) => x.integra).map((x) => `${x.nome} (${x.tipo})`))].join(", ") || "assinatura inválida"}` : " — sem assinatura digital";

/** Guarda o arquivo enviado para a NF e registra no histórico. */
export async function enviarDocumento(u: Usuario, notaId: number, tipoId: number, arquivo: File) {
  const ext = extensao(arquivo.name);
  const mime = TIPOS_ARQUIVO[ext];
  if (!mime) throw new Error("Envie um arquivo PDF (ou imagem JPG/PNG, ou XML).");
  if (!arquivo.size) throw new Error("O arquivo está vazio.");
  if (arquivo.size > TAMANHO_MAX) throw new Error(`O arquivo tem ${(arquivo.size / 1048576).toFixed(1)} MB; o limite é 4 MB. Reduza o PDF (ex.: “Reduzir tamanho” no leitor de PDF) e envie de novo.`);
  const [tipo] = await sql<TipoDocumento[]>`select * from tipos_documento where id = ${tipoId} and ativo`;
  if (!tipo) throw new Error("Escolha o tipo do documento.");
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  if (ext === "pdf" && Buffer.from(bytes.subarray(0, 1024)).toString("latin1").indexOf("%PDF") < 0) throw new Error("O arquivo não é um PDF válido.");
  const hash = sha256(bytes);
  const [repetido] = await sql`select t.nome from documentos d join tipos_documento t on t.id = d.tipo_id where d.nota_id = ${notaId} and d.sha256 = ${hash} and d.removido_em is null`;
  if (repetido) throw new Error(`Este mesmo arquivo já está anexado nesta NF (${repetido.nome}).`);
  const assinaturas = ext === "pdf" ? await assinaturasDoPdf(bytes) : [];
  if (tipo.exige_assinatura && !assinaturas.length)
    throw new Error(`O documento “${tipo.nome}” precisa estar assinado digitalmente (gov.br ou token). Assine o PDF e envie de novo.`);
  if (tipo.exige_assinatura && !assinaturas.some((a) => a.integra))
    throw new Error("A assinatura deste PDF não confere: o arquivo pode ter sido alterado depois de assinado. Assine de novo e envie.");
  const nome = arquivo.name.replace(/[^\w.\- ()À-ÿ]/g, "_").slice(-120);
  const local = await guardar(`notas/${notaId}/${hash.slice(0, 16)}-${nome}`, bytes, mime);
  return sql.begin(async (tx) => {
    const [d] = await tx`insert into documentos (nota_id, tipo_id, nome_arquivo, mime, tamanho, sha256, armazenamento, chave, conteudo, assinaturas, enviado_por, enviado_por_nome)
      values (${notaId}, ${tipo.id}, ${nome}, ${mime}, ${bytes.length}, ${hash}, ${local.armazenamento}, ${local.chave},
              ${local.armazenamento === "banco" ? Buffer.from(bytes) : null}, ${tx.json(assinaturas as never)}, ${u.id}, ${u.nome}) returning id`;
    await registrarEvento(tx, { nota_id: notaId, tipo: "documento", usuario: u, texto: `${tipo.nome} anexado: ${nome}${resumoAssinaturas(assinaturas)}` });
    return { id: d.id as number, assinaturas, tipo: tipo.nome };
  });
}

export async function arquivoDoDocumento(id: number) {
  const [d] = await sql`select d.id, d.nota_id, d.nome_arquivo, d.mime, d.armazenamento, d.chave, d.conteudo from documentos d where d.id = ${id} and d.removido_em is null`;
  if (!d) return null;
  const bytes = d.armazenamento === "banco" ? new Uint8Array(d.conteudo as Buffer) : await ler(d.chave as string);
  return { notaId: d.nota_id as number, nome: d.nome_arquivo as string, mime: d.mime as string, bytes };
}

/** Remove da NF (o arquivo e o registro continuam guardados para auditoria) e registra o motivo no histórico. */
export async function removerDocumento(u: Usuario, id: number, motivo: string) {
  if (!motivo.trim()) throw new Error("Informe o motivo da remoção.");
  return sql.begin(async (tx) => {
    const [d] = await tx`select d.nota_id, d.nome_arquivo, d.enviado_por, t.nome as tipo from documentos d join tipos_documento t on t.id = d.tipo_id
                         where d.id = ${id} and d.removido_em is null for update`;
    if (!d) throw new Error("Documento não encontrado.");
    if (u.papel !== "admin" && d.enviado_por !== u.id) throw new Error("Só quem enviou o documento (ou o administrador) pode removê-lo.");
    await tx`update documentos set removido_em = now(), removido_por_nome = ${u.nome}, motivo_remocao = ${motivo.trim().slice(0, 500)} where id = ${id}`;
    await registrarEvento(tx, { nota_id: d.nota_id, tipo: "documento", usuario: u, texto: `${d.tipo} removido: ${d.nome_arquivo}. Motivo: ${motivo.trim()}` });
    return d.nota_id as number;
  });
}

/** Configuração (administrador): tipos e documentos obrigatórios por etapa. */
export async function regrasDocumentos() {
  const [tipos, regras] = await Promise.all([
    tiposDocumento(true),
    sql<{ etapa_id: number; tipo_id: number }[]>`select etapa_id, tipo_id from etapa_documentos`,
  ]);
  return { tipos, regras };
}

export async function usoArmazenamento() {
  const [r] = await sql`select count(*)::int as arquivos, coalesce(sum(tamanho), 0)::bigint as bytes,
                               coalesce(sum(tamanho) filter (where armazenamento = 'banco'), 0)::bigint as no_banco
                        from documentos where removido_em is null`;
  return { arquivos: r.arquivos as number, bytes: Number(r.bytes), noBanco: Number(r.no_banco) };
}
