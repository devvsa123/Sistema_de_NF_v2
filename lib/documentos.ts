import "server-only";
import { sql, type Tx } from "./db";
import type { Usuario } from "./auth";
import { registrarEvento } from "./fluxo";
import { guardar, ler, lerFluxo } from "./arquivos";
import { assinaturasDoPdf, sha256, type Assinatura } from "./assinatura";
import { PDFDocument } from "pdf-lib";
import { getDocumentProxy } from "unpdf";
import { nfComCertificado } from "./pdf-recebimento";
import { camposDeAssinatura, type CampoAssinatura } from "./pdf-assinar";

/** Marcas que o sistema grava nos PDFs que gera (TAV, Check-list): tipo do documento e NF. */
async function marcasDoPdf(bytes: Uint8Array): Promise<{ doc?: string; nota?: number }> {
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    const k = pdf.getKeywords() ?? "";
    return { doc: /nf-doc:([\w-]+)/.exec(k)?.[1], nota: Number(/nf-nota:(\d+)/.exec(k)?.[1]) || undefined };
  } catch {
    return {};
  }
}
const TIPO_GERADO: Record<string, string> = { tav: "TAV", checklist: "Check-list da Contagem", "nf-certificado": "Nota fiscal (DANFE)", parecer: "Parecer da Divisão Técnica" };
export const TIPO_NF = "Nota fiscal (DANFE)";

/** O PDF já traz um Certificado de Recebimento de Bens (feito fora do sistema)? */
async function temCertificado(bytes: Uint8Array) {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    for (let i = 1; i <= pdf.numPages; i++) {
      const t = await (await pdf.getPage(i)).getTextContent();
      const txt = t.items.map((x) => ("str" in x ? x.str : "")).join(" ").toUpperCase();
      if (txt.includes("CERTIFICADO DE RECEBIMENTO") || txt.includes("CERTIFICADO DE PRESTAÇÃO DE SERVIÇOS") || txt.includes("CERTIFICADO DE PRESTACAO DE SERVICOS")) return true;
    }
  } catch { /* sem texto legível */ }
  return false;
}

/** Documentos da NF: envio, conferência das assinaturas, download e regras de tramitação. */

/** Tamanho máximo de um documento. Arquivos grandes sobem em partes (a Vercel limita cada requisição a ~4,5 MB). */
export const TAMANHO_MAX = 25 * 1024 * 1024;
/** Tamanho de cada parte no envio em partes. */
export const TAMANHO_PARTE = 3 * 1024 * 1024;
const TIPOS_ARQUIVO: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", xml: "application/xml" };

export type TipoDocumento = { id: number; nome: string; exige_assinatura: boolean; ordem: number; ativo: boolean };
export type Documento = {
  id: number; nota_id: number; tipo_id: number; tipo: string; exige_assinatura: boolean; nome_arquivo: string; mime: string; tamanho: number;
  assinaturas: Assinatura[]; enviado_por: number | null; enviado_por_nome: string | null; criado_em: Date; arquivo_excluido_em: Date | null;
};

export async function tiposDocumento(todos = false) {
  return sql<TipoDocumento[]>`select * from tipos_documento ${todos ? sql`` : sql`where ativo`} order by ordem, nome`;
}

/** Um documento conta como entregue quando não exige assinatura ou tem ao menos uma assinatura íntegra. */
export const valido = (d: { exige_assinatura: boolean; assinaturas: Assinatura[] }) => !d.exige_assinatura || d.assinaturas.some((a) => a.integra);

export async function documentosDaNota(notaId: number) {
  return sql<Documento[]>`
    select d.id, d.nota_id, d.tipo_id, t.nome as tipo, t.exige_assinatura, d.nome_arquivo, d.mime, d.tamanho, d.assinaturas,
           d.enviado_por, d.enviado_por_nome, d.criado_em, d.arquivo_excluido_em
    from documentos d join tipos_documento t on t.id = d.tipo_id
    where d.nota_id = ${notaId} and d.removido_em is null order by t.ordem, d.criado_em`;
}

/** Tipos obrigatórios para a NF sair da etapa e quais ainda faltam. */
/**
 * NF sob medida: o material vai direto ao usuário e só a parte burocrática passa pelo Depósito. TAV, Check-list
 * da Contagem, Relatório e Parecer não são obrigatórios (podem ser anexados, mas não cobram anexo nem assinatura).
 */
const DISPENSADOS_SOB_MEDIDA = [/^TAV$/i, /check-?list/i, /relat[oó]rio/i, /parecer/i, /laudo pericial/i];
export const dispensadoSobMedida = (tipo: string) => DISPENSADOS_SOB_MEDIDA.some((r) => r.test(tipo.trim()));

export async function pendencias(db: Tx | typeof sql, notaId: number, etapaId: number | null) {
  if (!etapaId) return { exigidos: [] as TipoDocumento[], faltando: [] as TipoDocumento[] };
  const [nota] = await db`select sob_medida from notas where id = ${notaId}`;
  const exigidos = (await db<TipoDocumento[]>`select t.* from etapa_documentos ed join tipos_documento t on t.id = ed.tipo_id
                                              where ed.etapa_id = ${etapaId} and t.ativo order by t.ordem`)
    .filter((t) => !(nota?.sob_medida && dispensadoSobMedida(t.nome)));
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
export async function enviarDocumento(u: Usuario, notaId: number, tipoId: number, arquivo: File, opcoes: { semAssinatura?: boolean } = {}) {
  const ext = extensao(arquivo.name);
  const mime = TIPOS_ARQUIVO[ext];
  if (!mime) throw new Error("Envie um arquivo PDF (ou imagem JPG/PNG, ou XML).");
  if (!arquivo.size) throw new Error("O arquivo está vazio.");
  if (arquivo.size > TAMANHO_MAX) throw new Error(`O arquivo tem ${(arquivo.size / 1048576).toFixed(1)} MB; o limite é 25 MB. Reduza o PDF (ex.: “Reduzir tamanho” no leitor de PDF) e envie de novo.`);
  let bytes = new Uint8Array(await arquivo.arrayBuffer());
  if (ext === "pdf" && Buffer.from(bytes.subarray(0, 1024)).toString("latin1").indexOf("%PDF") < 0) throw new Error("O arquivo não é um PDF válido.");
  const marcas = ext === "pdf" ? await marcasDoPdf(bytes) : {};
  if (marcas.nota && marcas.nota !== notaId) {
    const [outra] = await sql`select numero from notas where id = ${marcas.nota}`;
    throw new Error(`Este documento foi gerado para outra NF${outra ? ` (NF ${outra.numero})` : ""}. Confira o arquivo.`);
  }
  if (marcas.doc === "tav-minuta") throw new Error("Este arquivo é uma MINUTA do TAV, só para conferência, e não pode ser anexado. Emita o TAV no sistema (Documentos do Recebimento) e anexe ou assine o TAV emitido.");
  const gerado = marcas.doc ? TIPO_GERADO[marcas.doc] : undefined;
  const [tipo] = tipoId
    ? await sql<TipoDocumento[]>`select * from tipos_documento where id = ${tipoId} and ativo`
    : gerado ? await sql<TipoDocumento[]>`select * from tipos_documento where nome = ${gerado} and ativo` : [];
  if (!tipo) throw new Error(gerado ? `O tipo “${gerado}” não está ativo. Escolha o tipo do documento.` : "Escolha o tipo do documento (só o TAV e o Check-list gerados pelo sistema são reconhecidos sozinhos).");
  if (gerado && tipo.nome !== gerado) throw new Error(`Este arquivo é um ${gerado} gerado pelo sistema, mas foi escolhido o tipo “${tipo.nome}”.`);
  // PDF da NF: acrescenta o Certificado de Recebimento de Bens (com os campos de assinatura), se ainda não tiver
  let certificado = "";
  if (tipo.nome === TIPO_NF && ext === "pdf" && marcas.doc !== "nf-certificado" && !(await temCertificado(bytes))) {
    const [n] = await sql`select numero, recebida_em, tipo_nf from notas where id = ${notaId}`;
    const ano = new Date(n.recebida_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric" });
    // NF de serviço leva o Certificado de Prestação de Serviços; de material, o de Recebimento de Bens
    const servico = n.tipo_nf === "servico";
    const comCert = await nfComCertificado(bytes, { numero_nf: n.numero, ano }, { nota: notaId }, servico ? "servico" : "material");
    if (comCert) { bytes = new Uint8Array(comCert); certificado = ` (${servico ? "Certificado de Prestação de Serviços" : "Certificado de Recebimento de Bens"} acrescentado)`; }
  }
  const hash = sha256(bytes);
  const [repetido] = await sql`select t.nome from documentos d join tipos_documento t on t.id = d.tipo_id where d.nota_id = ${notaId} and d.sha256 = ${hash} and d.removido_em is null`;
  if (repetido) throw new Error(`Este mesmo arquivo já está anexado nesta NF (${repetido.nome}).`);
  const assinaturas = ext === "pdf" ? await assinaturasDoPdf(bytes) : [];
  let campos: CampoAssinatura[] | null = null;
  if (ext === "pdf") try { campos = await camposDeAssinatura(bytes); } catch { campos = []; }
  if (tipo.exige_assinatura && !assinaturas.length && !opcoes.semAssinatura)
    throw new Error(`O documento “${tipo.nome}” precisa estar assinado digitalmente (gov.br ou token). Assine o PDF e envie de novo.`);
  if (tipo.exige_assinatura && assinaturas.length && !assinaturas.some((a) => a.integra))
    throw new Error("A assinatura deste PDF não confere: o arquivo pode ter sido alterado depois de assinado. Assine de novo e envie.");
  const nome = arquivo.name.replace(/[^\w.\- ()À-ÿ]/g, "_").slice(-120);
  const local = await guardar(`notas/${notaId}/${hash.slice(0, 16)}-${nome}`, bytes, mime);
  return sql.begin(async (tx) => {
    const [d] = await tx`insert into documentos (nota_id, tipo_id, nome_arquivo, mime, tamanho, sha256, armazenamento, chave, conteudo, assinaturas, enviado_por, enviado_por_nome, campos)
      values (${notaId}, ${tipo.id}, ${nome}, ${mime}, ${bytes.length}, ${hash}, ${local.armazenamento}, ${local.chave},
              ${local.armazenamento === "banco" ? Buffer.from(bytes) : null}, ${tx.json(assinaturas as never)}, ${u.id}, ${u.nome},
              ${campos ? tx.json(campos as never) : null}) returning id`;
    await registrarEvento(tx, { nota_id: notaId, tipo: "documento", usuario: u, texto: `${tipo.nome} anexado: ${nome}${certificado}${resumoAssinaturas(assinaturas)}` });
    return { id: d.id as number, assinaturas, tipo: tipo.nome };
  });
}

export async function arquivoDoDocumento(id: number) {
  const [d] = await sql`select d.id, d.nota_id, d.nome_arquivo, d.mime, d.armazenamento, d.chave, d.conteudo, d.arquivo_excluido_em
                        from documentos d where d.id = ${id} and d.removido_em is null`;
  if (!d) return null;
  if (d.arquivo_excluido_em) throw new Error("O arquivo deste documento foi excluído do sistema na finalização da NF (está no pacote final baixado pelo Controle).");
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

// ------------------------------------------------------------------ check-list geral da NF

export type ChecklistNF = {
  etapas: { id: number; nome: string; atual: boolean; passada: boolean; itens: { tipo: string; exige_assinatura: boolean; ok: boolean }[] }[];
  assinaturas: { id: number; tipo: string; nome: string; faltam: string[]; invalida: boolean }[];
  faltamDocumentos: number; faltamAssinaturas: number; sobMedida: boolean;
};

/**
 * Campos de assinatura que deixaram de ser exigidos (TAV e Check-list emitidos antes de terem um só signatário):
 * não contam como assinatura pendente.
 */
const CAMPOS_DISPENSADOS = new Set(["Encarregado Secao Recebimento", "Conferente do Recebimento"]);
export const campoExigido = (c: CampoAssinatura) => !CAMPOS_DISPENSADOS.has(c.nome);

/** "FIEL DE ARMAZENAGEM" → "Fiel de Armazenagem" (rótulos dos campos do certificado vêm em maiúsculas). */
export function nomeDoCampo(c: CampoAssinatura) {
  const r = (c.rotulo || c.nome).trim();
  if (r !== r.toUpperCase()) return r;
  const minusc = new Set(["de", "da", "do", "das", "dos", "e", "pelo", "pela"]);
  return r.toLowerCase().split(/\s+/).map((p, i) => (i && minusc.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
}

/**
 * Check-list geral da NF: os documentos obrigatórios de todas as etapas (o que já foi e o que falta) e,
 * nos documentos anexados, as assinaturas que ainda faltam (campos de assinatura vazios).
 */
export async function checklistDaNota(nota: { id: number; status: string; etapa_id: number | null }): Promise<ChecklistNF> {
  const { etapasAtivas } = await import("./fluxo");
  const [etapas, { tipos, regras }, [sm]] = await Promise.all([etapasAtivas(), regrasDocumentos(), sql`select sob_medida, categoria from notas where id = ${nota.id}`]);
  // Mapa de devolução: nenhum documento é obrigatório
  if (sm?.categoria === "mapa") return { etapas: [], assinaturas: [], faltamDocumentos: 0, faltamAssinaturas: 0, sobMedida: false };
  const dispensa = (tipo: string) => !!sm?.sob_medida && dispensadoSobMedida(tipo);
  const docs = await sql<{ id: number; tipo_id: number; tipo: string; nome_arquivo: string; mime: string; exige_assinatura: boolean; assinaturas: Assinatura[]; campos: CampoAssinatura[] | null; arquivo_excluido_em: Date | null }[]>`
    select d.id, d.tipo_id, t.nome as tipo, d.nome_arquivo, d.mime, t.exige_assinatura, d.assinaturas, d.campos, d.arquivo_excluido_em
    from documentos d join tipos_documento t on t.id = d.tipo_id where d.nota_id = ${nota.id} and d.removido_em is null order by t.ordem, d.criado_em`;
  // PDFs enviados antes desta função: lê os campos uma vez e guarda
  for (const d of docs) {
    if (d.campos || d.mime !== "application/pdf" || d.arquivo_excluido_em) continue;
    try {
      const a = await arquivoDoDocumento(d.id);
      d.campos = a ? await camposDeAssinatura(a.bytes) : [];
    } catch { d.campos = []; }
    await sql`update documentos set campos = ${sql.json(d.campos as never)} where id = ${d.id}`;
  }
  const entregues = new Set(docs.filter((d) => valido(d)).map((d) => d.tipo_id));
  const iAtual = etapas.findIndex((e) => e.id === nota.etapa_id);
  const encerrada = nota.status !== "em_tramite" && nota.status !== "reprovada";
  const lista = etapas.map((e, i) => ({
    id: e.id, nome: e.nome, atual: i === iAtual && !encerrada, passada: encerrada || (iAtual >= 0 && i < iAtual),
    itens: regras.filter((r) => r.etapa_id === e.id).map((r) => tipos.find((t) => t.id === r.tipo_id)).filter((t): t is TipoDocumento => !!t && t.ativo && !dispensa(t.nome))
      .sort((a, b) => a.ordem - b.ordem).map((t) => ({ tipo: t.nome, exige_assinatura: t.exige_assinatura, ok: entregues.has(t.id) })),
  })).filter((e) => e.itens.length);
  const assinaturas = docs.filter((d) => !dispensa(d.tipo)).map((d) => ({
    id: d.id, tipo: d.tipo, nome: d.nome_arquivo,
    faltam: (d.campos ?? []).filter((c) => !c.assinado && campoExigido(c)).map(nomeDoCampo),
    invalida: d.assinaturas.some((a) => !a.integra),
  })).filter((d) => d.faltam.length || d.invalida);
  // um documento obrigatório conta uma vez, mesmo exigido em mais de uma etapa
  const faltamTipos = new Set(lista.flatMap((e) => e.itens.filter((x) => !x.ok).map((x) => x.tipo)));
  return { etapas: lista, assinaturas, faltamDocumentos: faltamTipos.size, faltamAssinaturas: assinaturas.reduce((t, d) => t + d.faltam.length, 0), sobMedida: !!sm?.sob_medida };
}

// ------------------------------------------------------------------ envio em partes (arquivos grandes)

/** Guarda uma parte de um envio. As partes de envios abandonados são apagadas depois de 1 dia. */
export async function guardarParte(u: Usuario, envio: string, parte: number, dados: Uint8Array) {
  if (!/^[0-9a-f-]{36}$/i.test(envio) || !Number.isInteger(parte) || parte < 0 || parte > 20) throw new Error("Envio inválido.");
  if (!dados.length || dados.length > TAMANHO_PARTE + 1024) throw new Error("Parte do arquivo com tamanho inválido.");
  await sql`delete from envios_partes where criado_em < now() - interval '1 day'`;
  await sql`insert into envios_partes (envio, parte, usuario_id, dados) values (${envio}, ${parte}, ${u.id}, ${Buffer.from(dados)})
            on conflict (envio, parte) do update set dados = excluded.dados, criado_em = now()`;
}

/** Junta as partes do envio (na ordem) e apaga as partes. */
export async function montarEnvio(u: Usuario, envio: string, total: number, tamanho: number) {
  const partes = await sql<{ parte: number; dados: Buffer }[]>`
    select parte, dados from envios_partes where envio = ${envio} and usuario_id = ${u.id} order by parte`;
  await sql`delete from envios_partes where envio = ${envio}`;
  if (partes.length !== total || partes.some((p, i) => p.parte !== i)) throw new Error("O arquivo não chegou completo. Envie de novo.");
  const bytes = new Uint8Array(Buffer.concat(partes.map((p) => p.dados)));
  if (bytes.length !== tamanho) throw new Error("O arquivo chegou com tamanho diferente do original. Envie de novo.");
  return bytes;
}

/** Arquivo para download: do R2 em fluxo contínuo (sem carregar tudo na memória), ou do banco. */
export async function fluxoDoDocumento(id: number) {
  const [d] = await sql`select d.nome_arquivo, d.mime, d.armazenamento, d.chave, d.conteudo, d.arquivo_excluido_em, d.tamanho
                        from documentos d where d.id = ${id} and d.removido_em is null`;
  if (!d) return null;
  if (d.arquivo_excluido_em) throw new Error("O arquivo deste documento foi excluído do sistema na finalização da NF (está no pacote final baixado pelo Controle).");
  const corpo = d.armazenamento === "banco" ? new Uint8Array(d.conteudo as Buffer) : await lerFluxo(d.chave as string);
  return { nome: d.nome_arquivo as string, mime: d.mime as string, tamanho: d.tamanho as number, corpo };
}

// ------------------------------------------------------------------ pendências até a etapa atual (fila)

/** Etapa responsável por cada campo de assinatura (pelo nome/rótulo do campo). */
const RESPONSAVEL_CAMPO: [RegExp, RegExp][] = [
  [/pr[eé].?recebimento/i, /pr[eé].?receb/i],
  [/contagem/i, /contagem/i],
  [/divis[aã]o t[eé]cnica/i, /t[eé]cnica/i],
  [/diretor/i, /diretor/i],
  [/perito/i, /per[ií]cia/i],
  [/armazenagem|servidor respons/i, /estocagem|armazen/i],
  [/suprimentos/i, /controle/i],
  [/gestor/i, /abastecimento/i],
];

type EtapaBasica = { id: number; nome: string; setor: string };

function etapaDoCampo(c: CampoAssinatura, etapas: EtapaBasica[]) {
  const texto = `${c.nome} ${c.rotulo}`;
  const regra = RESPONSAVEL_CAMPO.find(([campo]) => campo.test(texto));
  if (!regra) return -1;
  return etapas.findIndex((e) => regra[1].test(`${e.nome} ${e.setor}`));
}

const NOME_CURTO: Record<string, string> = {
  "Nota fiscal (DANFE)": "NF", "Parecer da Divisão Técnica": "Parecer", "Relatório de ensaio visual": "Relatório", "Check-list da Contagem": "Check-list",
};
const curto = (tipo: string) => NOME_CURTO[tipo] ?? tipo;

export type PendenciaFila = { documentos: string[]; assinaturas: string[] };

/**
 * O que falta até a etapa atual (as obrigações se acumulam): documentos obrigatórios da etapa atual e das anteriores
 * e assinaturas cuja etapa responsável já chegou (ex.: o TAV sem a assinatura do Pré-Recebimento continua aparecendo
 * no Diretor). Relatórios sem campo de assinatura (Word/Adobe) precisam da assinatura da Técnica quando a NF chega lá.
 */
export async function pendenciasAteAgora(notas: { id: number; status: string; etapa_id: number | null; sob_medida?: boolean }[]): Promise<Map<number, PendenciaFila>> {
  const saida = new Map<number, PendenciaFila>();
  const ativas = notas.filter((n) => n.status === "em_tramite" && n.etapa_id);
  if (!ativas.length) return saida;
  const { etapasAtivas } = await import("./fluxo");
  const [etapas, { tipos, regras }] = await Promise.all([etapasAtivas(), regrasDocumentos()]);
  const ids = ativas.map((n) => n.id);
  const docs = await sql<{ id: number; nota_id: number; tipo_id: number; tipo: string; mime: string; exige_assinatura: boolean; assinaturas: Assinatura[]; campos: CampoAssinatura[] | null; arquivo_excluido_em: Date | null }[]>`
    select d.id, d.nota_id, d.tipo_id, t.nome as tipo, d.mime, t.exige_assinatura, d.assinaturas, d.campos, d.arquivo_excluido_em
    from documentos d join tipos_documento t on t.id = d.tipo_id where d.nota_id in ${sql(ids)} and d.removido_em is null`;
  // PDFs antigos sem os campos lidos: lê alguns por vez (os demais nas próximas aberturas da fila)
  let lidos = 0;
  for (const d of docs) {
    if (d.campos || d.mime !== "application/pdf" || d.arquivo_excluido_em || lidos >= 12) continue;
    lidos++;
    try {
      const a = await arquivoDoDocumento(d.id);
      d.campos = a ? await camposDeAssinatura(a.bytes) : [];
    } catch { d.campos = []; }
    await sql`update documentos set campos = ${sql.json(d.campos as never)} where id = ${d.id}`;
  }
  // quem assina pela Técnica (nome do certificado), para os relatórios assinados fora do sistema
  const iTec = etapas.findIndex((e) => /t[eé]cnica/i.test(`${e.nome} ${e.setor}`));
  const tecnicos = iTec < 0 ? new Set<string>() : new Set((await sql`
    select distinct u.cert_nome from usuarios u join usuario_etapas ue on ue.usuario_id = u.id
    where ue.etapa_id = ${etapas[iTec].id} and u.cert_nome is not null`).map((r) => String(r.cert_nome).toUpperCase()));

  for (const n of ativas) {
    const iAtual = etapas.findIndex((e) => e.id === n.etapa_id);
    if (iAtual < 0) continue;
    const devidas = new Set(etapas.slice(0, iAtual + 1).map((e) => e.id));
    const dispensa = (tipo: string) => !!n.sob_medida && dispensadoSobMedida(tipo);
    const meus = docs.filter((d) => d.nota_id === n.id && !dispensa(d.tipo));
    const entregues = new Set(meus.filter((d) => valido(d)).map((d) => d.tipo_id));
    const faltaDocs = [...new Set(regras.filter((r) => devidas.has(r.etapa_id) && !entregues.has(r.tipo_id))
      .map((r) => tipos.find((t) => t.id === r.tipo_id)).filter((t): t is TipoDocumento => !!t && t.ativo && !dispensa(t.nome))
      .sort((a, b) => a.ordem - b.ordem).map((t) => curto(t.nome)))];
    const faltaAss: string[] = [];
    for (const d of meus) {
      if (d.assinaturas.some((a) => !a.integra)) faltaAss.push(`assinatura que não confere (${curto(d.tipo)})`);
      const campos = d.campos ?? [];
      for (const c of campos) {
        if (c.assinado || !campoExigido(c)) continue;
        const i = etapaDoCampo(c, etapas);
        if (i >= 0 && i <= iAtual) faltaAss.push(`${nomeDoCampo(c)} (${curto(d.tipo)})`);
      }
      // relatório (feito e assinado fora do sistema): a Técnica também precisa assinar quando a NF chega nela
      if (/relat[oó]rio/i.test(d.tipo) && iTec >= 0 && iAtual >= iTec) {
        const validas = d.assinaturas.filter((a) => a.integra);
        const temTecnica = tecnicos.size ? validas.some((a) => tecnicos.has(a.nome.toUpperCase())) : validas.length >= 2;
        if (!temTecnica) faltaAss.push(`${etapas[iTec].nome} (${curto(d.tipo)})`);
      }
    }
    if (faltaDocs.length || faltaAss.length) saida.set(n.id, { documentos: faltaDocs, assinaturas: [...new Set(faltaAss)] });
  }
  return saida;
}
