import "server-only";
import { sql } from "./db";
import type { Usuario } from "./auth";
import { documentoRecebimento } from "./recebimento";
import { arquivoDoDocumento, enviarDocumento } from "./documentos";
import { registrarEvento } from "./fluxo";
import { camposDeAssinatura, encaixarAssinatura, prepararCampo, prepararNovoCampo, type CampoAssinatura } from "./pdf-assinar";
import { titularDaAssinatura } from "./assinatura";
import { DECISOES, type DecisaoEscolhida } from "./parecer-campos";
import { aplicarDecisao, podeDecidir, type DecisaoGravada } from "./parecer";
import { camposFixos } from "./laudo";

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

const NOME_TIPO = { tav: "TAV", checklist: "Check-list da Contagem" } as const;
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
  let tipoId = 0;
  if (s.documento_origem_id) {
    const [o] = await sql`select tipo_id from documentos where id = ${s.documento_origem_id}`;
    tipoId = (o?.tipo_id as number) ?? 0;
  }
  const r = await enviarDocumento(u, s.nota_id as number, tipoId, new File([Buffer.from(pdf)], s.nome_arquivo as string, { type: "application/pdf" }));
  const ultima = r.assinaturas[r.assinaturas.length - 1];
  if (!ultima?.integra) throw new Error("A assinatura devolvida pelo Assinador não confere com o documento.");
  await sql.begin(async (tx) => {
    await tx`update assinaturas_token set concluido_em = now(), documento_id = ${r.id}, pdf = null where id = ${id}`;
    if (s.base_documento_id) {
      const [ant] = await tx`update documentos set removido_em = now(), removido_por_nome = ${u.nome}, motivo_remocao = 'Substituído pela versão com mais assinaturas'
                             where id = ${s.base_documento_id} and removido_em is null returning nome_arquivo`;
      if (ant) await registrarEvento(tx, { nota_id: s.nota_id, tipo: "documento", usuario: u, texto: `${r.tipo}: versão anterior substituída pela versão com mais assinaturas` });
    }
    if (s.substituicao)
      await registrarEvento(tx, { nota_id: s.nota_id, tipo: "documento", usuario: u, texto: `${r.tipo} assinado por ${ultima.nome} como ${s.substituicao}` });
  });
  const extra = s.decisao ? await aplicarDecisao(u, s.nota_id as number, s.decisao as DecisaoGravada, s.substituicao as string | null) : "";
  const [n] = await sql`select numero from notas where id = ${s.nota_id}`;
  return { refazer: false as const, mensagem: `${r.tipo} da NF ${n.numero} assinado por ${ultima.nome}${s.substituicao ? `, ${s.substituicao}` : ""} (${ultima.tipo === "ICP-Brasil" ? "certificado ICP-Brasil" : ultima.tipo}).${extra}` };
}

// ------------------------------------------------------------------ qualquer documento anexado à NF

export type DocParaAssinar = {
  id: number; tipo: string; nome: string; criado_em: Date; assinaturas: string[]; campos: CampoAssinatura[];
};

/** Documentos PDF da NF, com os campos de assinatura (vazios ou não) e quem já assinou. */
export async function documentosParaAssinar(notaId: number): Promise<DocParaAssinar[]> {
  const docs = await sql<{ id: number; tipo: string; nome_arquivo: string; criado_em: Date; assinaturas: { nome: string; integra: boolean }[] }[]>`
    select d.id, t.nome as tipo, d.nome_arquivo, d.criado_em, d.assinaturas from documentos d join tipos_documento t on t.id = d.tipo_id
    where d.nota_id = ${notaId} and d.removido_em is null and d.mime = 'application/pdf' order by t.ordem, d.criado_em`;
  const saida: DocParaAssinar[] = [];
  for (const d of docs) {
    let campos: CampoAssinatura[] = [];
    try {
      const a = await arquivoDoDocumento(d.id);
      if (a) campos = await camposDeAssinatura(a.bytes);
    } catch { /* PDF sem formulário legível: assina em posição escolhida */ }
    saida.push({ id: d.id, tipo: d.tipo, nome: d.nome_arquivo, criado_em: d.criado_em, assinaturas: d.assinaturas.filter((x) => x.integra).map((x) => x.nome), campos });
  }
  return saida;
}

export type Alvo = { campo: string } | { pagina: number; x: number; y: number };

/**
 * Vice-Diretor assinando no lugar do Diretor (campo do Diretor ou posição escolhida na página):
 * devolve a qualidade ("Vice-Diretor, no impedimento do Diretor") e as linhas de identificação dele.
 */
export async function substituicaoDiretor(u: Usuario, alvo: Alvo, nomeCertificado: string) {
  if (!u.vice_diretor) return null;
  if ("campo" in alvo && !/diretor/i.test(alvo.campo)) return null;
  const fixos = Object.fromEntries((await camposFixos()).map((c) => [c.chave, c.valor?.trim() ?? ""]));
  const titular = /diretora/i.test(fixos.diretor_cargo ?? "") ? "da Diretora" : "do Diretor";
  const cargo = fixos.vice_cargo || "Vice-Diretor";
  const qualidade = `${cargo}, no impedimento ${titular}`;
  return { qualidade, rodape: [(fixos.vice_nome || nomeCertificado).toUpperCase(), fixos.vice_posto ?? "", qualidade].filter(Boolean) };
}

/** Prepara a assinatura de um documento anexado: num campo existente ou numa posição escolhida na página. */
export async function prepararDocumento(u: Usuario, documentoId: number, alvo: Alvo, decisao?: DecisaoEscolhida) {
  const certificado = await certificadoDoUsuario(u);
  if (!certificado) return { identificar: true as const };
  const sub = await substituicaoDiretor(u, alvo, certificado.nome);
  const cert = { ...certificado, qualidade: sub?.qualidade ?? null };
  const [d] = await sql`select id, nota_id, nome_arquivo from documentos where id = ${documentoId} and removido_em is null`;
  if (!d) throw new Error("Documento não encontrado (talvez já tenha sido substituído por uma versão mais nova). Atualize a página.");
  const a = await arquivoDoDocumento(d.id as number);
  if (!a) throw new Error("Arquivo não encontrado.");
  let gravada: DecisaoGravada | null = null;
  const def = "campo" in alvo ? DECISOES[alvo.campo] : undefined;
  if (def && "campo" in alvo) {
    if (!(await podeDecidir(u, alvo.campo))) throw new Error(`Só o ${def.setor} assina este campo.`);
    if (!decisao || !def.opcoes[decisao.opcao]) throw new Error(`Escolha a decisão (${def.opcoes.join(" / ")}) antes de assinar.`);
    gravada = { campo: alvo.campo, opcao: decisao.opcao, observacao: String(decisao.observacao ?? "").slice(0, 1500) };
  }
  const p = "campo" in alvo
    ? await prepararCampo(a.bytes, alvo.campo, cert, new Date(), gravada ? { titulo: def!.titulo, opcoes: def!.opcoes, escolhida: gravada.opcao, observacao: gravada.observacao, rodape: sub?.rodape } : undefined)
    : await prepararNovoCampo(a.bytes, Math.max(0, Math.floor(alvo.pagina)), Number(alvo.x), Number(alvo.y), `Assinatura de ${cert.nome}`, cert);
  const [s] = await sql`insert into assinaturas_token (usuario_id, nota_id, campo, nome_arquivo, pdf, posicao, resumo, base_documento_id, documento_origem_id, decisao, substituicao)
                        values (${u.id}, ${d.nota_id}, ${"campo" in alvo ? alvo.campo : `página ${alvo.pagina + 1}`}, ${d.nome_arquivo}, ${Buffer.from(p.pdf)},
                                ${p.posicao}, ${p.resumo}, ${d.id}, ${d.id}, ${gravada ? sql.json(gravada as never) : null}, ${sub?.qualidade ?? null}) returning id`;
  return { id: s.id as number, resumo: p.resumo };
}
