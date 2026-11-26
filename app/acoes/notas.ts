"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { exigirUsuario, podeCadastrar } from "@/lib/auth";
import { ajustarComoAdmin, definirIdPa, etapasAtivas, executarAcao, podeEditarIdPa, registrarEvento, type Acao, type OpcoesAcao } from "@/lib/fluxo";
import { analisarDocumento, cadastrarManual, cadastrarMapa, cadastrarPorDocumento, obterNota, type Documento } from "@/lib/notas";
import { textoBusca } from "@/lib/nfe";
import { enviarDocumento, TIPO_NF } from "@/lib/documentos";
import { classificarNF, NOME_TIPO_NF } from "@/lib/tipo-nf";
import { TIPO_EVENTO } from "@/lib/format";
import { cienteAoResponder, lerMarcados, observarComMarcacao } from "@/lib/mencoes";
import type { Estado } from "@/components/FormAcao";

const ACOES: Acao[] = ["avancar", "retornar", "reprovar", "retirar", "reabrir", "arrecadar", "armazenar"];
const msg = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");
const campo = (f: FormData, nome: string) => String(f.get(nome) ?? "").trim();

/** Tramita uma ou várias NF de uma vez. Cada NF é validada individualmente. */
export async function acaoTramitar(ids: number[], acao: Acao, op: OpcoesAcao = {}) {
  const u = await exigirUsuario();
  if (!ACOES.includes(acao) || !Array.isArray(ids) || ids.length === 0 || ids.length > 200) return { feitas: 0, erros: ["Requisição inválida."] };
  const opcoes = { obs: String(op.obs ?? "").slice(0, 2000), visual: String(op.visual ?? "").slice(0, 30), laboratorial: String(op.laboratorial ?? "").slice(0, 30) };
  let feitas = 0;
  const erros: string[] = [];
  for (const id of ids) {
    try {
      await executarAcao(u, Number(id), acao, { ...opcoes, comentario: true });
      feitas++;
    } catch (e) {
      erros.push(msg(e));
    }
  }
  revalidatePath("/", "layout");
  return { feitas, erros };
}

/**
 * Finalização direta pelo administrador geral (NF do trâmite antigo, com os documentos nas pastas da rede):
 * não exige documentos, assinaturas nem pacote final, e não exclui arquivos. Fica registrada no histórico com o motivo.
 */
export async function acaoFinalizarAdmin(ids: number[], motivo: string) {
  const u = await exigirUsuario();
  if (u.papel !== "admin") return { feitas: 0, erros: ["Somente o administrador geral pode finalizar dessa forma."] };
  const m = String(motivo ?? "").trim().slice(0, 1000);
  if (!m) return { feitas: 0, erros: ["Informe o motivo (ex.: trâmite antigo, documentos nas pastas da rede)."] };
  if (!Array.isArray(ids) || !ids.length || ids.length > 500) return { feitas: 0, erros: ["Selecione as NF."] };
  let feitas = 0;
  const erros: string[] = [];
  for (const id of ids) {
    try {
      const [n] = await sql`select numero, status from notas where id = ${Number(id)}`;
      if (!n) throw new Error("NF não encontrada.");
      if (n.status !== "em_tramite") throw new Error(`NF ${n.numero}: não está em trâmite.`);
      await ajustarComoAdmin(u, Number(id), "finalizada", `Finalizada pelo administrador geral (trâmite antigo): ${m}`);
      feitas++;
    } catch (e) {
      erros.push(msg(e));
    }
  }
  revalidatePath("/", "layout");
  return { feitas, erros };
}

/** Administrador geral: reclassifica NF como Mapa de devolução (ou volta para NF). Registrado no histórico. */
export async function acaoReclassificar(ids: number[], para: string) {
  const u = await exigirUsuario();
  if (u.papel !== "admin") return { feitas: 0, erros: ["Somente o administrador geral pode reclassificar."] };
  const destino = para === "mapa" ? "mapa" : "nf";
  if (!Array.isArray(ids) || !ids.length || ids.length > 500) return { feitas: 0, erros: ["Selecione as NF."] };
  let feitas = 0;
  for (const id of ids) {
    await sql.begin(async (tx) => {
      const [n] = await tx`update notas set categoria = ${destino} where id = ${Number(id)} and categoria <> ${destino} returning id`;
      if (n) {
        await registrarEvento(tx, { nota_id: n.id as number, tipo: "edicao", usuario: u,
          texto: destino === "mapa" ? "Reclassificada como Mapa de devolução (sai do trâmite e das metas das NF)." : "Reclassificada como NF (volta ao trâmite das NF)." });
        feitas++;
      }
    });
  }
  revalidatePath("/", "layout");
  return { feitas, erros: [] as string[] };
}

/** Cadastro de Mapa de devolução (com o PDF do mapa, opcional). */
export async function acaoCadastrarMapa(_: Estado, f: FormData): Promise<Estado> {
  const u = await exigirUsuario();
  let id: number;
  try {
    id = await cadastrarMapa(u, { numero: campo(f, "numero"), cam: campo(f, "cam"), data: campo(f, "data"), obs: campo(f, "obs") });
  } catch (e) {
    return { erro: msg(e) };
  }
  const arquivo = f.get("arquivo");
  if (arquivo instanceof File && arquivo.size) {
    try {
      const [t] = await sql`select id from tipos_documento where nome = 'Mapa de devolução' and ativo`;
      await enviarDocumento(u, id, (t?.id as number) ?? 0, arquivo);
    } catch { /* o mapa fica cadastrado; o PDF pode ser anexado depois na página do mapa */ }
  }
  revalidatePath("/", "layout");
  redirect(`/notas/${id}`);
}

export async function acaoObservacao(_: Estado, f: FormData): Promise<Estado> {
  const u = await exigirUsuario();
  if (u.papel !== "admin" && u.papel !== "interno") return { erro: "Seu perfil não permite registrar observações." };
  const id = Number(f.get("id"));
  const texto = campo(f, "texto").slice(0, 2000);
  if (!texto) return { erro: "Escreva a observação." };
  if (!(await obterNota(u, id))) return { erro: "NF não encontrada." };
  const r = await sql.begin(async (tx) => {
    const r = await observarComMarcacao(tx, u, id, texto, lerMarcados(f.get("marcados")));
    await cienteAoResponder(tx, u, id);
    return r;
  });
  revalidatePath("/", "layout");
  return { ok: r.avisados ? `Observação registrada. ${r.avisados} pessoa(s) avisada(s).` : "Observação registrada." };
}

/** ID de PA informado direto na fila. */
export async function acaoIdPaFila(id: number, valor: string): Promise<{ erro?: string; idPa?: string | null }> {
  const u = await exigirUsuario();
  const nota = await obterNota(u, Number(id));
  if (!nota) return { erro: "NF não encontrada." };
  if (!podeEditarIdPa(u, await etapasAtivas(), nota)) return { erro: "Você não pode alterar o ID de PA desta NF na etapa em que ela está." };
  try {
    await sql.begin((tx) => definirIdPa(tx, u, nota.id, valor));
  } catch (e) {
    return { erro: msg(e) };
  }
  revalidatePath("/");
  revalidatePath(`/notas/${nota.id}`);
  const v = String(valor ?? "").trim().slice(0, 30);
  return { idPa: v || null };
}

export type Comentario = { id: number; tipo: string; titulo: string; usuario: string; texto: string; em: string; marcados: string | null };

/** Todos os comentários (registros com texto) do histórico da NF, do mais recente para o mais antigo. */
export async function acaoComentarios(id: number): Promise<{ erro?: string; numero?: string; obsOc?: string; itens: Comentario[] }> {
  const u = await exigirUsuario();
  if (u.papel !== "admin" && u.papel !== "interno") return { erro: "Seu perfil não permite ver os comentários.", itens: [] };
  const nota = await obterNota(u, Number(id));
  if (!nota) return { erro: "NF não encontrada.", itens: [] };
  const linhas = await sql`select id, tipo, movimento, de_nome, para_nome, usuario_nome, texto, criado_em, marcados from eventos
                           where nota_id = ${nota.id} and (comentario or tipo = 'ciente') order by criado_em desc, id desc limit 500`;
  return {
    numero: nota.numero, obsOc: nota.obs_oc ?? undefined,
    itens: linhas.map((e) => ({
      id: e.id as number, tipo: e.tipo as string, texto: e.texto as string, usuario: (e.usuario_nome as string | null) ?? "—",
      titulo: e.movimento && e.de_nome ? `${e.de_nome} → ${e.para_nome}` : (TIPO_EVENTO[e.tipo as string] ?? (e.tipo as string)),
      em: (e.criado_em as Date).toISOString(), marcados: (e.marcados as string | null) ?? null,
    })),
  };
}

/** Registra uma observação direto da fila e devolve a lista atualizada. */
export async function acaoComentar(id: number, texto: string, marcados: string[] = []) {
  const u = await exigirUsuario();
  if (u.papel !== "admin" && u.papel !== "interno") return { erro: "Seu perfil não permite registrar observações.", itens: [] as Comentario[] };
  const t = String(texto ?? "").trim().slice(0, 2000);
  if (!t) return { erro: "Escreva a observação.", itens: [] as Comentario[] };
  const nota = await obterNota(u, Number(id));
  if (!nota) return { erro: "NF não encontrada.", itens: [] as Comentario[] };
  await sql.begin(async (tx) => {
    await observarComMarcacao(tx, u, nota.id, t, lerMarcados(marcados));
    await cienteAoResponder(tx, u, nota.id);
  });
  revalidatePath("/", "layout");
  revalidatePath(`/notas/${nota.id}`);
  return acaoComentarios(nota.id);
}

export async function acaoEditarNota(_: Estado, f: FormData): Promise<Estado> {
  const u = await exigirUsuario();
  if (!podeCadastrar(u)) return { erro: "Seu perfil não permite editar a NF." };
  const id = Number(f.get("id"));
  const oc = campo(f, "oc").slice(0, 60) || null;
  if (!oc) return { erro: "A OC não pode ficar em branco." };
  const [n] = await sql`select numero, chave, emit_nome, emit_cnpj, empenho, itens, natureza, oc, obs_oc, sob_medida, tipo_nf from notas where id = ${id}`;
  if (!n) return { erro: "NF não encontrada." };
  const obsOc = campo(f, "obs_oc").slice(0, 2000) || null;
  const sobMedida = f.get("sob_medida") === "on";
  const tipoNf = f.get("tipo_nf") === "servico" ? "servico" : f.get("tipo_nf") === "material" ? "material" : n.tipo_nf;
  const lido = classificarNF(n as never);
  const motivoTipo = tipoNf === lido.tipo ? lido.motivo : `alterado por ${u.nome}`;
  const mudou = [
    n.tipo_nf !== tipoNf && `Tipo da NF: ${NOME_TIPO_NF[n.tipo_nf as "material"]} → ${NOME_TIPO_NF[tipoNf as "material"]}`,
    n.oc !== oc && `OC: ${n.oc ?? "—"} → ${oc}`,
    !!n.sob_medida !== sobMedida && `Sob medida: ${n.sob_medida ? "sim" : "não"} → ${sobMedida ? "sim" : "não"}`,
    (n.obs_oc ?? null) !== obsOc && (obsOc ? `Observação da OC: ${obsOc}` : "Observação da OC removida"),
  ].filter(Boolean) as string[];
  if (!mudou.length) return { ok: "Nada foi alterado." };
  await sql.begin(async (tx) => {
    await tx`update notas set oc = ${oc}, obs_oc = ${obsOc}, sob_medida = ${sobMedida}, tipo_nf = ${tipoNf},
               tipo_nf_motivo = case when tipo_nf = ${tipoNf} then tipo_nf_motivo else ${motivoTipo} end,
               busca = ${textoBusca({ ...(n as Parameters<typeof textoBusca>[0]), oc })} where id = ${id}`;
    await registrarEvento(tx, { nota_id: id, tipo: "edicao", usuario: u, texto: mudou.join("\n") });
  });
  revalidatePath(`/notas/${id}`);
  return { ok: "Dados atualizados." };
}

export async function acaoAjusteAdmin(_: Estado, f: FormData): Promise<Estado> {
  const u = await exigirUsuario();
  const id = Number(f.get("id"));
  try {
    await ajustarComoAdmin(u, id, campo(f, "destino"), campo(f, "motivo"));
  } catch (e) {
    return { erro: msg(e) };
  }
  revalidatePath("/", "layout");
  return { ok: "NF ajustada." };
}

const LIMITE_DOC = 2.9 * 1024 * 1024;
function documento(tipo: string, conteudo: string): Documento {
  if ((tipo !== "xml" && tipo !== "pdf") || typeof conteudo !== "string" || !conteudo || conteudo.length > LIMITE_DOC) throw new Error("Arquivo inválido ou maior que 2 MB.");
  return { tipo, conteudo };
}

export async function acaoAnalisarDocumento(tipo: string, conteudo: string) {
  const u = await exigirUsuario();
  if (!podeCadastrar(u)) return { erro: "Seu perfil não permite cadastrar NF." };
  try {
    const { nf, existente, bloqueio, tipo: tipoNf, motivo, origem } = await analisarDocumento(documento(tipo, conteudo));
    return {
      previa: {
        chave: nf.chave, numero: nf.numero, serie: nf.serie, emit_cnpj: nf.emit_cnpj, emit_nome: nf.emit_nome, valor: nf.valor,
        data_emissao: nf.data_emissao, oc: nf.oc, empenho: nf.empenho, itens: nf.itens.length, existente, bloqueio, tipo: tipoNf, motivo, origem,
      },
    };
  } catch (e) {
    return { erro: msg(e) };
  }
}

export async function acaoCadastrarDocumento(
  tipo: string, conteudo: string,
  op: { oc?: string; sobMedida?: boolean; obs?: string; tipoNf?: string; danfe?: { nome: string; conteudo: string } | null; nomeArquivo?: string },
) {
  const u = await exigirUsuario();
  let danfe: Uint8Array | null = null;
  if (op.danfe?.conteudo) {
    danfe = new Uint8Array(Buffer.from(String(op.danfe.conteudo), "base64"));
    if (danfe.length > 3 * 1048576) return { erro: "O PDF da DANFE tem mais de 3 MB. Reduza o tamanho e envie de novo." };
  }
  try {
    const tipoNf = op.tipoNf === "servico" || op.tipoNf === "material" ? op.tipoNf : undefined;
    const doc = documento(tipo, conteudo);
    // confere, antes de cadastrar, se o PDF é desta NF (quando o PDF tem texto; DANFE escaneada não dá para conferir)
    if (danfe) {
      const { nf } = await analisarDocumento(doc);
      const chaves = await chavesNoPdf(danfe);
      if (chaves.length && !chaves.includes(nf.chave)) return { erro: `O PDF da DANFE é de outra NF (chave ${chaves[0]}). Confira o arquivo.` };
    }
    const r = await cadastrarPorDocumento(u, doc, { oc: String(op.oc ?? "").slice(0, 60), sobMedida: !!op.sobMedida, obs: String(op.obs ?? "").slice(0, 2000), tipoNf });
    let aviso = "";
    // cadastro pela própria DANFE: o PDF enviado já é o documento da NF (com o certificado como última página)
    if (!danfe && r.origem === "danfe") danfe = new Uint8Array(Buffer.from(doc.conteudo, "base64"));
    if (danfe && r.anexado) {
      // NF que já existia (ex.: cadastro manual com a NF digitalizada): não duplica o documento da NF
      const [ja] = await sql`select 1 from documentos d join tipos_documento t on t.id = d.tipo_id where d.nota_id = ${r.id} and t.nome = ${TIPO_NF} and d.removido_em is null limit 1`;
      if (ja) { danfe = null; aviso = "Dados da NF-e anexados. A NF já tinha o PDF da NF nos documentos, por isso este PDF não foi anexado de novo."; }
    }
    if (danfe) {
      try {
        const [t] = await sql`select id from tipos_documento where nome = ${TIPO_NF} and ativo`;
        const nome = String(op.danfe?.nome || op.nomeArquivo || `NF-${r.numero}.pdf`).replace(/[^\w.\- ()À-ÿ]/g, "_").slice(-120);
        await enviarDocumento(u, r.id, (t?.id as number) ?? 0, new File([Buffer.from(danfe)], /\.pdf$/i.test(nome) ? nome : `${nome}.pdf`, { type: "application/pdf" }));
      } catch (e) {
        aviso = `NF cadastrada, mas o PDF da DANFE não foi anexado: ${msg(e)}. Anexe-o na página da NF.`;
      }
    }
    revalidatePath("/", "layout");
    return { ok: { ...r, aviso } };
  } catch (e) {
    return { erro: msg(e) };
  }
}

/** Chaves de acesso (44 dígitos) escritas no texto do PDF. */
async function chavesNoPdf(bytes: Uint8Array) {
  try {
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    let txt = "";
    for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) txt += " " + (await (await pdf.getPage(i)).getTextContent()).items.map((x) => ("str" in x ? x.str : "")).join(" ");
    return [...new Set([...txt.matchAll(/(?<!\d)(\d{4}(?:[ .]?\d{4}){10})(?!\d)/g)].map((m) => m[1].replace(/\D/g, "")))];
  } catch {
    return [];
  }
}

export async function acaoCadastrarManual(_: Estado, f: FormData): Promise<Estado> {
  const u = await exigirUsuario();
  // a NF digitalizada é obrigatória: é o documento que segue no trâmite para as assinaturas
  const arquivo = f.get("digitalizada");
  if (!(arquivo instanceof File) || !arquivo.size) return { erro: "Anexe a NF digitalizada (PDF) para cadastrar." };
  if (!/\.pdf$/i.test(arquivo.name) && arquivo.type !== "application/pdf") return { erro: "A NF digitalizada precisa ser um arquivo PDF." };
  if (arquivo.size > 4 * 1048576) return { erro: "A NF digitalizada tem mais de 4 MB. Digitalize em resolução menor (ex.: 200 dpi, tons de cinza) e envie de novo." };
  let id: number;
  try {
    const valor = Number(campo(f, "valor").replace(/\./g, "").replace(",", "."));
    id = await cadastrarManual(u, {
      chave: campo(f, "chave"), numero: campo(f, "numero"), cnpj: campo(f, "cnpj"), nome: campo(f, "nome"),
      valor, oc: campo(f, "oc"), sobMedida: f.get("sob_medida") === "on", obs: campo(f, "obs"),
      tipoNf: campo(f, "tipo_nf") === "servico" ? "servico" : "material",
    });
  } catch (e) {
    return { erro: msg(e) };
  }
  try {
    const [t] = await sql`select id from tipos_documento where nome = ${TIPO_NF} and ativo`;
    await enviarDocumento(u, id, (t?.id as number) ?? 0, arquivo);
  } catch (e) {
    // sem a NF digitalizada a nota não segue: desfaz o cadastro
    await sql.begin(async (tx) => { await tx`delete from eventos where nota_id = ${id}`; await tx`delete from notas where id = ${id}`; });
    return { erro: `A NF não foi cadastrada: ${msg(e)}` };
  }
  revalidatePath("/", "layout");
  redirect(`/notas/${id}`);
}
