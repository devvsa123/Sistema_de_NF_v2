import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { sql } from "./db";
import type { Usuario } from "./auth";
import { documentoRecebimento } from "./recebimento";
import { arquivoDoDocumento, enviarDocumento } from "./documentos";
import { registrarEvento } from "./fluxo";

/** Assinatura pelo Adobe: o sistema entrega o PDF ao Assistente de Assinatura e recebe o PDF assinado de volta. */

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

type Sessao = { id: number; usuario_id: number; nota_id: number; registro_id: number; doc: "tav" | "checklist"; expira_em: Date; enviado_em: Date | null; base_documento_id: number | null };

const NOME_TIPO = { tav: "TAV", checklist: "Check-list de Recebimento" } as const;

export async function criarSessao(u: Usuario, registroId: number, doc: "tav" | "checklist") {
  const [r] = await sql`select nota_id, doc, criado_em from docs_recebimento where id = ${registroId}`;
  if (!r || (r.doc !== "ambos" && r.doc !== doc)) throw new Error("Documento não encontrado.");
  // se este documento já foi anexado assinado (depois desta emissão), a próxima assinatura vai sobre essa versão
  const [base] = await sql`select d.id from documentos d join tipos_documento t on t.id = d.tipo_id
                           where d.nota_id = ${r.nota_id} and t.nome = ${NOME_TIPO[doc]} and d.removido_em is null and d.criado_em >= ${r.criado_em}
                           order by d.criado_em desc limit 1`;
  const token = randomBytes(24).toString("base64url");
  const [s] = await sql`insert into assinaturas_pendentes (token_hash, usuario_id, nota_id, registro_id, doc, base_documento_id)
                        values (${hash(token)}, ${u.id}, ${r.nota_id}, ${registroId}, ${doc}, ${base?.id ?? null}) returning id`;
  return { id: s.id as number, token };
}

async function sessao(token: string) {
  const [s] = await sql<Sessao[]>`select id, usuario_id, nota_id, registro_id, doc, expira_em, enviado_em, base_documento_id from assinaturas_pendentes where token_hash = ${hash(token)}`;
  if (!s) throw new Error("Link de assinatura inválido.");
  if (s.enviado_em) throw new Error("Este documento já foi assinado e enviado por este link. Clique em “Assinar no Adobe” de novo para outra assinatura.");
  if (s.expira_em < new Date()) throw new Error("O link de assinatura expirou (45 minutos). Clique em “Assinar no Adobe” de novo.");
  const [u] = await sql<Usuario[]>`
    select u.id, u.login, u.nome, u.papel, u.empresa_cnpj, u.pode_cadastrar, u.trata_reprovadas, u.gerencia_usuarios, u.deve_trocar_senha,
           coalesce((select array_agg(ue.etapa_id) from usuario_etapas ue where ue.usuario_id = u.id), '{}') as etapas
    from usuarios u where u.id = ${s.usuario_id} and u.ativo`;
  if (!u) throw new Error("Usuário inativo.");
  return { s, u };
}

/** PDF para o Assistente abrir no Adobe. */
export async function pdfParaAssinar(token: string) {
  const { s, u } = await sessao(token);
  const d = await documentoRecebimento(s.registro_id, s.doc, u, "pdf");
  if (!d) throw new Error("Documento não encontrado.");
  if (s.base_documento_id) {
    const base = await arquivoDoDocumento(s.base_documento_id);
    if (base) d.bytes = base.bytes; // versão já assinada por outra pessoa: assina o campo que falta
  }
  await sql`update assinaturas_pendentes set baixado_em = coalesce(baixado_em, now()) where id = ${s.id}`;
  return d;
}

/** PDF assinado devolvido pelo Assistente: confere e anexa na NF. */
export async function receberAssinado(token: string, bytes: Uint8Array, nome: string) {
  const { s, u } = await sessao(token);
  try {
    const arquivo = new File([Buffer.from(bytes)], nome.toLowerCase().endsWith(".pdf") ? nome : `${nome}.pdf`, { type: "application/pdf" });
    const r = await enviarDocumento(u, s.nota_id, 0, arquivo);
    const quem = [...new Set(r.assinaturas.filter((a) => a.integra).map((a) => a.nome))].join(", ");
    const [n] = await sql`select numero from notas where id = ${s.nota_id}`;
    const mensagem = `${r.tipo} anexado à NF ${n.numero}${quem ? `, assinado por ${quem}` : ""}.`;
    await sql`update assinaturas_pendentes set enviado_em = now(), documento_id = ${r.id}, mensagem = ${mensagem} where id = ${s.id}`;
    if (s.base_documento_id && r.assinaturas.filter((a) => a.integra).length > 1) {
      // a versão anterior (com menos assinaturas) sai da lista; continua guardada para auditoria
      await sql.begin(async (tx) => {
        const [ant] = await tx`update documentos set removido_em = now(), removido_por_nome = ${u.nome}, motivo_remocao = 'Substituído pela versão com mais assinaturas'
                               where id = ${s.base_documento_id} and removido_em is null returning nome_arquivo`;
        if (ant) await registrarEvento(tx, { nota_id: s.nota_id, tipo: "documento", usuario: u, texto: `${r.tipo}: versão anterior (${ant.nome_arquivo}) substituída pela versão com mais assinaturas` });
      });
    }
    return mensagem;
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "Erro ao receber o documento.";
    await sql`update assinaturas_pendentes set mensagem = ${mensagem} where id = ${s.id}`;
    throw e;
  }
}

export async function situacaoSessao(u: Usuario, id: number) {
  const [s] = await sql`select baixado_em, enviado_em, mensagem, expira_em < now() as expirou from assinaturas_pendentes where id = ${id} and usuario_id = ${u.id}`;
  if (!s) return { estado: "inexistente" as const, mensagem: "" };
  const estado = s.enviado_em ? "enviado" : s.expirou ? "expirado" : s.baixado_em ? "aberto" : "aguardando";
  return { estado: estado as "enviado" | "expirado" | "aberto" | "aguardando", mensagem: (s.mensagem as string | null) ?? "" };
}
