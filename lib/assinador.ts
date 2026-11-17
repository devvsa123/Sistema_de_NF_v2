import "server-only";
import { sql } from "./db";
import type { Usuario } from "./auth";
import { documentoRecebimento } from "./recebimento";
import { arquivoDoDocumento, enviarDocumento } from "./documentos";
import { registrarEvento } from "./fluxo";
import { camposDeAssinatura, encaixarAssinatura, prepararCampo } from "./pdf-assinar";
import { titularDaAssinatura } from "./assinatura";

type Certificado = { nome: string; cpf: string | null };

async function certificadoDoUsuario(u: Usuario): Promise<Certificado | null> {
  const [r] = await sql`select cert_nome, cert_cpf from usuarios where id = ${u.id}`;
  return r?.cert_nome ? { nome: r.cert_nome as string, cpf: (r.cert_cpf as string | null) ?? null } : null;
}

/** Guarda o titular do certificado a partir de uma assinatura feita pelo Assinador (nome completo e CPF para o selo). */
export async function identificarCertificado(u: Usuario, assinaturaBase64: string) {
  const t = titularDaAssinatura(assinaturaBase64);
  await sql`update usuarios set cert_nome = ${t.nome}, cert_cpf = ${t.cpf}, cert_emissor = ${t.emissor}, cert_em = now() where id = ${u.id}`;
  return t;
}

/** Assinatura com o token pelo Assinador SERPRO (o navegador fala com o Assinador; o sistema prepara e confere o PDF). */

const NOME_TIPO = { tav: "TAV", checklist: "Check-list de Recebimento" } as const;
const VALIDADE_MIN = 15;

/** Versão a assinar: a última já anexada (com assinaturas) desta emissão, ou o PDF gerado agora. */
async function versaoAtual(u: Usuario, registroId: number, doc: "tav" | "checklist") {
  const [r] = await sql`select nota_id, doc, criado_em from docs_recebimento where id = ${registroId}`;
  if (!r || (r.doc !== "ambos" && r.doc !== doc)) throw new Error("Documento não encontrado.");
  const gerado = await documentoRecebimento(registroId, doc, u, "pdf");
  if (!gerado) throw new Error("Documento não encontrado.");
  const [base] = await sql`select d.id from documentos d join tipos_documento t on t.id = d.tipo_id
                           where d.nota_id = ${r.nota_id} and t.nome = ${NOME_TIPO[doc]} and d.removido_em is null and d.criado_em >= ${r.criado_em}
                           order by d.criado_em desc limit 1`;
  if (base) {
    const a = await arquivoDoDocumento(base.id as number);
    if (a) return { notaId: r.nota_id as number, pdf: a.bytes, nome: gerado.nome, baseId: base.id as number };
  }
  return { notaId: r.nota_id as number, pdf: gerado.bytes, nome: gerado.nome, baseId: null };
}

export async function camposParaAssinar(u: Usuario, registroId: number, doc: "tav" | "checklist") {
  const v = await versaoAtual(u, registroId, doc);
  return camposDeAssinatura(v.pdf);
}

export async function prepararAssinatura(u: Usuario, registroId: number, doc: "tav" | "checklist", campo: string) {
  const cert = await certificadoDoUsuario(u);
  if (!cert) return { identificar: true as const };
  const v = await versaoAtual(u, registroId, doc);
  const p = await prepararCampo(v.pdf, campo, cert);
  const [s] = await sql`insert into assinaturas_token (usuario_id, nota_id, registro_id, doc, campo, nome_arquivo, pdf, posicao, resumo, base_documento_id)
                        values (${u.id}, ${v.notaId}, ${registroId}, ${doc}, ${campo}, ${v.nome}, ${Buffer.from(p.pdf)}, ${p.posicao}, ${p.resumo}, ${v.baseId}) returning id`;
  return { id: s.id as number, resumo: p.resumo };
}

export async function concluirAssinatura(u: Usuario, id: number, assinaturaBase64: string) {
  const [s] = await sql`select * from assinaturas_token where id = ${id} and usuario_id = ${u.id}`;
  if (!s) throw new Error("Assinatura não encontrada.");
  if (s.concluido_em) throw new Error("Esta assinatura já foi concluída.");
  if (Date.now() - new Date(s.criado_em).getTime() > VALIDADE_MIN * 60000) throw new Error("O tempo para assinar acabou. Clique em Assinar de novo.");
  // o selo foi desenhado com o certificado guardado; se a pessoa usou outro token, atualiza e pede para assinar de novo
  const cert = await certificadoDoUsuario(u);
  const t = titularDaAssinatura(assinaturaBase64);
  if (!cert || cert.nome !== t.nome || (cert.cpf ?? null) !== (t.cpf ?? null)) {
    await identificarCertificado(u, assinaturaBase64);
    await sql`delete from assinaturas_token where id = ${id}`;
    return { refazer: true as const, mensagem: "" };
  }
  const pdf = encaixarAssinatura(new Uint8Array(s.pdf as Buffer), s.posicao as number, assinaturaBase64);
  const r = await enviarDocumento(u, s.nota_id as number, 0, new File([Buffer.from(pdf)], s.nome_arquivo as string, { type: "application/pdf" }));
  const ultima = r.assinaturas[r.assinaturas.length - 1];
  if (!ultima?.integra) throw new Error("A assinatura devolvida pelo Assinador não confere com o documento.");
  await sql.begin(async (tx) => {
    await tx`update assinaturas_token set concluido_em = now(), documento_id = ${r.id}, pdf = null where id = ${id}`;
    if (s.base_documento_id) {
      const [ant] = await tx`update documentos set removido_em = now(), removido_por_nome = ${u.nome}, motivo_remocao = 'Substituído pela versão com mais assinaturas'
                             where id = ${s.base_documento_id} and removido_em is null returning nome_arquivo`;
      if (ant) await registrarEvento(tx, { nota_id: s.nota_id, tipo: "documento", usuario: u, texto: `${r.tipo}: versão anterior substituída pela versão com mais assinaturas` });
    }
  });
  const [n] = await sql`select numero from notas where id = ${s.nota_id}`;
  return { refazer: false as const, mensagem: `${r.tipo} da NF ${n.numero} assinado por ${ultima.nome} (${ultima.tipo === "ICP-Brasil" ? "certificado ICP-Brasil" : ultima.tipo}).` };
}
