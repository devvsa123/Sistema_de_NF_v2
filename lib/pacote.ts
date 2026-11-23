import "server-only";
import { sql, type Tx } from "./db";
import type { Usuario } from "./auth";
import { registrarEvento } from "./fluxo";
import { arquivoDoDocumento, pendencias } from "./documentos";
import { camposDeAssinatura } from "./pdf-assinar";
import { pdfHistorico, type HistoricoNF } from "./pdf-recebimento";
import { apagar } from "./arquivos";
import { TIPO_EVENTO } from "./format";
import type { Assinatura } from "./assinatura";
import type { ItemNF } from "./nfe";

/**
 * Pacote final da NF (última etapa, Controle): todos os documentos com todas as assinaturas + o histórico da NF.
 * O Controle baixa (ZIP), o navegador confere cada arquivo pelo SHA-256 e a pessoa confirma que abriu e conferiu.
 * Só então a NF pode ser finalizada; na finalização os arquivos são excluídos do sistema (o histórico fica).
 */

export type ArquivoPacote = { id: number; tipo: string; nome: string; sha256: string; tamanho: number; mime: string; assinaturas: string[] };
export type VerificacaoPacote = { arquivos: ArquivoPacote[]; pendencias: string[]; conferido: { em: Date; por: string } | null; obrigatorio: boolean };

/** Documentos atuais da NF e o que impede o pacote (campo de assinatura vazio, assinatura que não confere...). */
export async function verificarPacote(notaId: number): Promise<VerificacaoPacote> {
  const [n] = await sql`select id, etapa_id, pacote_conferido_em, pacote_conferido_por, pacote_docs from notas where id = ${notaId}`;
  if (!n) throw new Error("NF não encontrada.");
  const docs = await sql<{ id: number; tipo: string; exige_assinatura: boolean; nome_arquivo: string; mime: string; tamanho: number; sha256: string; assinaturas: Assinatura[]; arquivo_excluido_em: Date | null }[]>`
    select d.id, t.nome as tipo, t.exige_assinatura, d.nome_arquivo, d.mime, d.tamanho, d.sha256, d.assinaturas, d.arquivo_excluido_em
    from documentos d join tipos_documento t on t.id = d.tipo_id
    where d.nota_id = ${notaId} and d.removido_em is null order by t.ordem, d.criado_em`;
  const pend: string[] = [];
  const { faltando } = await pendencias(sql, notaId, n.etapa_id as number | null);
  for (const t of faltando) pend.push(`Falta anexar: ${t.nome}${t.exige_assinatura ? " (assinado)" : ""}.`);
  if (!docs.length) pend.push("A NF não tem documentos anexados.");
  const arquivos: ArquivoPacote[] = [];
  for (const d of docs) {
    if (d.arquivo_excluido_em) { pend.push(`${d.tipo} (${d.nome_arquivo}): o arquivo já foi excluído do sistema.`); continue; }
    const validas = d.assinaturas.filter((a) => a.integra);
    if (d.assinaturas.some((a) => !a.integra)) pend.push(`${d.tipo} (${d.nome_arquivo}): há assinatura que não confere com o arquivo.`);
    if (d.exige_assinatura && !validas.length) pend.push(`${d.tipo} (${d.nome_arquivo}): precisa estar assinado digitalmente.`);
    if (d.mime === "application/pdf") {
      try {
        const a = await arquivoDoDocumento(d.id);
        const vazios = a ? (await camposDeAssinatura(a.bytes)).filter((c) => !c.assinado) : [];
        if (vazios.length) pend.push(`${d.tipo} (${d.nome_arquivo}): falta assinar ${vazios.map((c) => c.rotulo || c.nome).join(", ")}.`);
      } catch (e) {
        if (e instanceof Error && /excluído|não encontrado/i.test(e.message)) pend.push(`${d.tipo} (${d.nome_arquivo}): ${e.message}`);
        /* PDF sem formulário legível: sem campos de assinatura a conferir */
      }
    }
    arquivos.push({ id: d.id, tipo: d.tipo, nome: d.nome_arquivo, sha256: d.sha256, tamanho: d.tamanho, mime: d.mime, assinaturas: [...new Set(validas.map((a) => a.nome))] });
  }
  const conferido = n.pacote_conferido_em && pacoteConfere(n.pacote_docs as { id: number; sha256: string }[] | null, arquivos)
    ? { em: n.pacote_conferido_em as Date, por: n.pacote_conferido_por as string } : null;
  return { arquivos, pendencias: pend, conferido, obrigatorio: await exigePacoteFinal() };
}

/** O pacote conferido corresponde exatamente aos documentos atuais (nada entrou, saiu ou mudou depois)? */
function pacoteConfere(conferidos: { id: number; sha256: string }[] | null, atuais: { id: number; sha256: string }[]) {
  if (!conferidos?.length || conferidos.length !== atuais.length) return false;
  const mapa = new Map(conferidos.map((c) => [c.id, c.sha256]));
  return atuais.every((a) => mapa.get(a.id) === a.sha256);
}

/** Registra que a pessoa baixou o pacote, o navegador conferiu os arquivos e ela confirmou a conferência. */
export async function confirmarPacote(u: Usuario, notaId: number, recebidos: { id: number; sha256: string }[], historicoSha: string) {
  const v = await verificarPacote(notaId);
  if (v.pendencias.length) throw new Error(`Ainda há pendências nos documentos: ${v.pendencias.join(" ")}`);
  if (!pacoteConfere(recebidos, v.arquivos))
    throw new Error("Os arquivos baixados não conferem com os documentos atuais da NF (algum documento mudou). Baixe o pacote de novo.");
  await sql.begin(async (tx) => {
    await tx`update notas set pacote_conferido_em = now(), pacote_conferido_por = ${u.nome},
               pacote_docs = ${tx.json(v.arquivos.map((a) => ({ id: a.id, sha256: a.sha256 })) as never)} where id = ${notaId}`;
    await registrarEvento(tx, {
      nota_id: notaId, tipo: "pacote", usuario: u,
      texto: `Pacote final baixado e conferido: ${v.arquivos.length} documento(s) com todas as assinaturas + histórico da NF (SHA-256 ${historicoSha.slice(0, 16)}…). `
        + v.arquivos.map((a) => `${a.tipo}: ${a.nome} (SHA-256 ${a.sha256.slice(0, 16)}…)`).join("; "),
    });
  });
}

/** A finalização exige o pacote final? (Administração → Documentos da NF; desligada enquanto houver NF do trâmite antigo) */
export async function exigePacoteFinal(db: Tx | typeof sql = sql) {
  const [r] = await db`select valor from config where chave = 'exigir_pacote_final'`;
  return r?.valor === "sim";
}

export async function salvarExigenciaPacote(ligar: boolean) {
  await sql`insert into config (chave, valor) values ('exigir_pacote_final', ${ligar ? "sim" : "nao"}) on conflict (chave) do update set valor = excluded.valor`;
}

/** O pacote final da NF foi conferido com os documentos atuais? */
async function pacoteConferido(db: Tx | typeof sql, notaId: number) {
  const [n] = await db`select pacote_conferido_em, pacote_docs from notas where id = ${notaId}`;
  const atuais = await db<{ id: number; sha256: string }[]>`select id, sha256 from documentos where nota_id = ${notaId} and removido_em is null`;
  return !!n?.pacote_conferido_em && pacoteConfere(n.pacote_docs as { id: number; sha256: string }[] | null, atuais);
}

/** Para a finalização: com a exigência ligada, o pacote precisa estar conferido com os documentos atuais. */
export async function bloqueioFinalizacao(tx: Tx, nota: { id: number; numero: string }) {
  if (!(await exigePacoteFinal(tx))) return null;
  if (!(await pacoteConferido(tx, nota.id)))
    return `NF ${nota.numero}: antes de finalizar, baixe e confira o pacote final de documentos (página da NF → Pacote final da NF).`;
  return null;
}

/**
 * Depois de finalizada: exclui os arquivos (R2 ou banco), mantendo os registros, as assinaturas e todo o histórico.
 * Só exclui se o pacote final foi baixado e conferido com os documentos atuais (com a exigência desligada,
 * NF finalizada sem pacote continua com os arquivos no sistema).
 */
export async function excluirArquivosDaNota(u: Usuario, notaId: number) {
  if (!(await pacoteConferido(sql, notaId))) return;
  const docs = await sql<{ id: number; armazenamento: string; chave: string | null }[]>`
    select id, armazenamento, chave from documentos where nota_id = ${notaId} and arquivo_excluido_em is null`;
  let falhas = 0;
  for (const d of docs) {
    try {
      if (d.armazenamento === "r2" && d.chave) await apagar(d.chave);
      await sql`update documentos set conteudo = null, arquivo_excluido_em = now() where id = ${d.id}`;
    } catch {
      falhas++;
    }
  }
  await sql`update assinaturas_token set pdf = null where nota_id = ${notaId}`;
  await registrarEvento(sql, {
    nota_id: notaId, tipo: "pacote", usuario: u,
    texto: `Arquivos dos documentos excluídos do sistema na finalização (${docs.length - falhas} de ${docs.length}). O histórico, os dados e o registro das assinaturas continuam na NF.`
      + (falhas ? ` ${falhas} arquivo(s) não puderam ser excluídos agora.` : ""),
  });
}

/** Histórico da NF em PDF (vai no pacote final). */
export async function historicoDaNota(u: Usuario, notaId: number) {
  const [n] = await sql`select n.id, n.numero, n.serie, n.chave, n.emit_nome, n.emit_cnpj, n.valor, n.oc, n.empenho, n.natureza, n.data_emissao, n.tipo_nf,
                               n.sob_medida, n.id_pa, n.recebida_em, n.status, n.obs_oc, n.itens, case when n.status = 'em_tramite' then e.nome end as etapa
                        from notas n left join etapas e on e.id = n.etapa_id where n.id = ${notaId}`;
  if (!n) throw new Error("NF não encontrada.");
  const [eventos, documentos] = await Promise.all([
    sql<HistoricoNF["eventos"]>`select criado_em, tipo, de_nome, para_nome, usuario_nome, texto from eventos where nota_id = ${notaId} order by criado_em, id`,
    sql<{ tipo: string; nome_arquivo: string; enviado_por_nome: string | null; criado_em: Date; sha256: string; tamanho: number; removido_em: Date | null; motivo_remocao: string | null; assinaturas: Assinatura[] }[]>`
      select t.nome as tipo, d.nome_arquivo, d.enviado_por_nome, d.criado_em, d.sha256, d.tamanho, d.removido_em, d.motivo_remocao, d.assinaturas
      from documentos d join tipos_documento t on t.id = d.tipo_id where d.nota_id = ${notaId} order by d.removido_em nulls first, t.ordem, d.criado_em`,
  ]);
  const h: HistoricoNF = {
    nota: { ...(n as unknown as HistoricoNF["nota"]) },
    itens: ((n.itens as ItemNF[] | null) ?? []).map((i) => ({ n: i.n, codigo: i.codigo, descricao: i.descricao, qtd: i.qtd, un: i.un, vTotal: i.vTotal, cfop: i.cfop })),
    eventos,
    documentos: documentos.map((d) => ({
      tipo: d.tipo, nome: d.nome_arquivo, enviado_por: d.enviado_por_nome, criado_em: d.criado_em, sha256: d.sha256, tamanho: d.tamanho,
      removido: d.removido_em ? `${new Date(d.removido_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}${d.motivo_remocao ? ` - ${d.motivo_remocao}` : ""}` : null,
      assinaturas: d.assinaturas.map((a) => ({ nome: a.nome, tipo: a.tipo, quando: a.quando, integra: a.integra })),
    })),
    geradoPor: u.nome, geradoEm: new Date(),
  };
  const bytes = await pdfHistorico(h, { ...TIPO_EVENTO, pacote: "Pacote final" });
  return { bytes, nome: `Historico-NF${n.numero}.pdf` };
}
