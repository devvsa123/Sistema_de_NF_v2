import "server-only";
import { sql } from "./db";
import type { Usuario } from "./auth";
import { definirIdPa, etapasDoUsuario, type Etapa } from "./fluxo";
import { cnpj } from "./format";
import { preencherDocx } from "./docx";
import { camposFixos, modeloAtual } from "./laudo";
import { correlacionarNota, type LinhaCorrelacao } from "./estoque";
import { inserirTabela, type Tabela } from "./tabela-doc";
import { pdfChecklist, pdfTav } from "./pdf-recebimento";
import { numero as fmtNumero } from "./format";
import type { DadosNF, ItemNF } from "./nfe";

/** Documentos do Recebimento: TAV e Check-list, gerados a partir de modelos (.odt ou .docx) editáveis. */

export const PERGUNTAS_TAV = [
  "Volumes entregues em conformidade com a nota fiscal?",
  "Itens entregues conferem com a quantidade de itens da nota fiscal?",
  "Itens por volume entregues conferem com a quantidade padrão?",
  "Volumes identificados com código de barras afixados externamente?",
  "Embalagens de acordo com o Manual de Embalagens da Marinha?",
  "Etiquetas das embalagens estão em conformidade com a norma de embalagem?",
  "Item acompanha laudo laboratorial?",
];

type Marcador = { chave: string; descricao: string; origem: "NF" | "Recebimento" };
const COMUNS: Marcador[] = [
  { chave: "numero_nf", descricao: "Número da NF", origem: "NF" },
  { chave: "numero_oc", descricao: "Número da OC", origem: "NF" },
  { chave: "nome_empresa", descricao: "Nome da empresa", origem: "NF" },
  { chave: "cnpj", descricao: "CNPJ da empresa", origem: "NF" },
  { chave: "numero_tav", descricao: "Número do TAV", origem: "Recebimento" },
  { chave: "ano", descricao: "Ano do TAV", origem: "Recebimento" },
  { chave: "data_recebimento", descricao: "Data do recebimento", origem: "Recebimento" },
  { chave: "responsavel", descricao: "Nome de quem imprimiu o documento (assinatura do responsável pelo pré-recebimento)", origem: "Recebimento" },
];
export const MARCADORES_TAV: Marcador[] = [
  ...COMUNS,
  { chave: "id_pa", descricao: "ID do PA", origem: "Recebimento" },
  { chave: "x_contagem", descricao: "X se a conferência foi por contagem manual", origem: "Recebimento" },
  { chave: "x_pesagem", descricao: "X se a conferência foi por pesagem", origem: "Recebimento" },
  ...PERGUNTAS_TAV.flatMap((p, i) => [
    { chave: `q${i + 1}_sim`, descricao: `X se SIM — ${p}`, origem: "Recebimento" as const },
    { chave: `q${i + 1}_nao`, descricao: `X se NÃO — ${p}`, origem: "Recebimento" as const },
  ]),
  { chave: "volumes", descricao: "Volumes", origem: "Recebimento" },
  { chave: "observacao", descricao: "Observação do TAV", origem: "Recebimento" },
  { chave: "tabela_itens", descricao: "Tabela de itens para a contagem (item da NF × estoque, CXP e caixas). Sozinho num parágrafo; sem ele, a tabela vai para o fim do TAV", origem: "Recebimento" },
];
export const MARCADORES_CHECKLIST: Marcador[] = [
  ...COMUNS,
  { chave: "peso_kg", descricao: "Peso de um volume (kg)", origem: "Recebimento" },
  { chave: "itens_caixa", descricao: "Itens por caixa", origem: "Recebimento" },
  { chave: "data_envio_amostra", descricao: "Data de envio da amostra à Divisão Técnica", origem: "Recebimento" },
  { chave: "obs_recebimento", descricao: "Observação do recebimento (item 2)", origem: "Recebimento" },
  { chave: "discrepancia_sim", descricao: "X se houve discrepância na contagem", origem: "Recebimento" },
  { chave: "discrepancia_nao", descricao: "X se não houve discrepância na contagem", origem: "Recebimento" },
  { chave: "obs_contagem", descricao: "Observação da contagem (item 4)", origem: "Recebimento" },
];

/** Uma linha do Check-list da Contagem (item da NF, ou tamanho da grade), com o que a Contagem encontrou. */
export type ItemContagem = {
  ref: string; n: number; pi: string | null; item: string; qtd: number; un: string;
  peso: string; discrepancia: "Sim" | "Não"; diferenca: string;
  contada?: string;                  // contagem manual: quantidade contada (a diferença sai dela)
};
/** O que vem do formulário do Check-list para cada linha. */
export type ContagemInformada = { ref: string; peso: string; discrepancia: string; diferenca: string; contada?: string };
/** Como a conferência foi feita (vem do TAV): contagem manual pede a quantidade contada; pesagem, o peso. */
export type ModoConferencia = "contagem" | "pesagem";
export const modoDaConferencia = (conferencia: string | undefined): ModoConferencia => (conferencia === "Contagem manual" ? "contagem" : "pesagem");

export type DadosRecebimento = {
  numero_tav: string; data_recebimento: string; id_pa: string; lote: string; fabricacao: string; volumes: string;
  conferencia: string; respostas: string[]; observacao: string;
  peso_kg: string; itens_caixa: string; data_envio_amostra: string; obs_recebimento: string; discrepancia: string; obs_contagem: string;
  contagem?: ItemContagem[];
};

/** Usuários das etapas marcadas (Pré Recebimento e Contagem), somente enquanto a NF está numa delas. */
/** Usuários das etapas marcadas e o administrador geral, sempre com a NF numa dessas etapas. */
export function podeEmitirRecebimento(u: Usuario, etapas: Etapa[], nota: { status: string; etapa_id: number | null }) {
  if ((u.papel !== "interno" && u.papel !== "admin") || nota.status !== "em_tramite") return false;
  return etapasDoUsuario(u, etapas).some((e) => e.emite_docs_recebimento && e.id === nota.etapa_id);
}

export type DocRecebimento = "tav" | "checklist";

export function validarTav(d: DadosRecebimento): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.data_recebimento)) return "Informe a data do recebimento.";
  if (d.conferencia !== "Contagem manual" && d.conferencia !== "Pesagem") return "Escolha se a conferência foi por contagem manual ou pesagem.";
  if (d.respostas.length !== PERGUNTAS_TAV.length || d.respostas.some((r) => r !== "Sim" && r !== "Não"))
    return "Responda SIM ou NÃO para todas as perguntas do TAV.";
  if (d.observacao.length > 600) return "Observação longa demais para o espaço do documento.";
  return null;
}

export function validarChecklist(d: DadosRecebimento): string | null {
  if (d.obs_contagem.length > 1500) return "A observação geral tem no máximo 1.500 caracteres.";
  return null;
}

/** "2,5" → 2.5; "1.250,5" → 1250.5; "2.5" → 2.5; "1.250" → 1250. */
const numeroBR = (s: string) => {
  const t = String(s ?? "").trim().replace(/\s/g, "");
  if (t.includes(",")) return Number(t.replace(/\./g, "").replace(",", "."));
  return Number(/^-?\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t);
};

/**
 * Monta as linhas do Check-list da Contagem a partir dos itens da NF ligados ao estoque.
 * Todos os PIs precisam estar confirmados (PI na nota, confirmado ou automático) antes de emitir.
 */
async function montarContagem(nota: { emit_cnpj: string; itens: ItemNF[] | null }, informada: ContagemInformada[], modo: ModoConferencia = "pesagem"): Promise<ItemContagem[]> {
  const { linhas, catalogoVazio } = await correlacionarNota(nota);
  if (catalogoVazio) throw new Error("O catálogo do estoque não está disponível agora: tente de novo em instantes.");
  if (!linhas.length) throw new Error("Esta NF não tem itens lidos do XML para a contagem.");
  const pendentes = linhas.filter((l) => l.confianca === "media" || l.confianca === "nenhuma" || !l.item);
  if (pendentes.length)
    throw new Error(`Confirme o PI antes de emitir o Check-list: ${pendentes.map((l) => `item ${l.n}${l.tamanho ? ` (tam. ${l.tamanho})` : ""}`).join(", ")}.`);
  const porRef = new Map(informada.map((c) => [c.ref, c]));
  return linhas.map((l) => {
    const c = porRef.get(l.ref);
    const rot = `item ${l.n}${l.tamanho ? ` (tam. ${l.tamanho})` : ""}`;
    const base = { ref: l.ref, n: l.n, pi: l.item?.pi ?? null, item: l.item?.descricao ?? l.descricao, qtd: Number(l.qtd) || 0, un: l.un };
    if (modo === "contagem") {
      // contagem manual: a pessoa informa quanto contou; a diferença para a NF sai sozinha
      const contada = numeroBR(c?.contada ?? "");
      if (!c?.contada?.trim() || !Number.isFinite(contada) || contada < 0) throw new Error(`Informe a quantidade contada do ${rot}.`);
      const dif = Math.round((contada - base.qtd) * 1000) / 1000;
      return { ...base, peso: "", contada: String(contada), discrepancia: dif ? "Sim" : "Não", diferenca: dif ? String(dif) : "" } as ItemContagem;
    }
    const peso = numeroBR(c?.peso ?? "");
    if (!c?.peso?.trim() || !(peso > 0)) throw new Error(`Informe o peso dos volumes do ${rot} (em kg, sem a tara da caixa).`);
    if (c.discrepancia !== "Sim" && c.discrepancia !== "Não") throw new Error(`Informe se houve discrepância na contagem do ${rot}.`);
    let diferenca = "";
    if (c.discrepancia === "Sim") {
      const dif = numeroBR(c.diferenca);
      if (!c.diferenca.trim() || !Number.isFinite(dif) || dif === 0)
        throw new Error(`Informe a quantidade a maior (ex.: 5) ou a menor (ex.: -3) do ${rot}.`);
      diferenca = String(dif);
    }
    return { ref: l.ref, n: l.n, pi: l.item?.pi ?? null, item: l.item?.descricao ?? l.descricao, qtd: Number(l.qtd) || 0, un: l.un,
      peso: String(peso), discrepancia: c.discrepancia, diferenca };
  });
}

const dataBR = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : "");

/** Número do TAV com quatro dígitos e o ano: 0001/2026. */
export const numeroTav = (numero: number | string, ano: number | string) => `${String(numero).padStart(4, "0")}/${ano}`;

export async function proximoTav(ano: number) {
  const [r] = await sql`select coalesce(max(numero_tav), 0) + 1 as n from docs_recebimento where ano = ${ano}`;
  return r.n as number;
}

async function valoresDoc(u: Usuario, n: { numero: string; oc: string | null; emit_nome: string; emit_cnpj: string }, d: DadosRecebimento) {
  const x = (cond: boolean) => (cond ? "X" : "");
  const fixos = await camposFixos();
  return {
    numero_nf: n.numero, numero_oc: n.oc ?? "", nome_empresa: n.emit_nome, cnpj: cnpj(n.emit_cnpj), responsavel: u.nome,
    numero_tav: d.numero_tav.trim().padStart(4, "0"), ano: d.data_recebimento.slice(0, 4), data_recebimento: dataBR(d.data_recebimento),
    id_pa: d.id_pa.trim(), lote: d.lote.trim(), fabricacao: d.fabricacao.trim(), volumes: d.volumes.trim(), observacao: d.observacao.trim() || "_________",
    x_contagem: x(d.conferencia === "Contagem manual"), x_pesagem: x(d.conferencia === "Pesagem"),
    ...Object.fromEntries(d.respostas.flatMap((r, i) => [[`q${i + 1}_sim`, x(r === "Sim")], [`q${i + 1}_nao`, x(r === "Não")]])),
    peso_kg: d.peso_kg.trim(), itens_caixa: d.itens_caixa.trim(), data_envio_amostra: dataBR(d.data_envio_amostra) || "   /   /    ",
    obs_recebimento: d.obs_recebimento.trim() || "_".repeat(49), discrepancia_sim: x(d.discrepancia === "Sim"), discrepancia_nao: x(d.discrepancia === "Não"),
    obs_contagem: d.obs_contagem.trim() || "_".repeat(80), // vazio: mantém a linha para preencher à mão
    ...Object.fromEntries(fixos.map((f) => [f.chave, f.valor])),
  } as Record<string, string>;
}

/** Último TAV emitido para a NF (o Check-list usa o número, a data e a identificação dele). */
export async function ultimoTav(notaId: number) {
  const [r] = await sql<{ id: number; dados: { formulario: DadosRecebimento } }[]>`
    select id, dados from docs_recebimento where nota_id = ${notaId} and doc in ('tav', 'ambos') order by criado_em desc limit 1`;
  return r ?? null;
}

/** Emite o TAV (Pré Recebimento) ou o Check-list (Contagem), cada um no seu momento. */
export async function emitirDocRecebimento(u: Usuario, notaId: number, doc: DocRecebimento, d: DadosRecebimento) {
  const [n] = await sql`select id, numero, oc, emit_cnpj, emit_nome, itens from notas where id = ${notaId}`;
  if (!n) throw new Error("NF não encontrada.");
  if (doc === "checklist") {
    const tav = await ultimoTav(notaId);
    if (!tav) throw new Error("Emita primeiro o TAV desta NF: o Check-list usa o número e a data do TAV.");
    const contagem = await montarContagem({ emit_cnpj: n.emit_cnpj as string, itens: n.itens as ItemNF[] | null }, (d.contagem ?? []) as unknown as ContagemInformada[],
      modoDaConferencia(tav.dados.formulario.conferencia));
    d = { ...tav.dados.formulario, contagem, obs_contagem: d.obs_contagem };
  }
  const ano = Number(d.data_recebimento.slice(0, 4));
  return sql.begin(async (tx) => {
    let numero = Number(d.numero_tav);
    if (doc === "tav") {
      // número automático e único por ano; a mesma NF reemitida no mesmo ano mantém o número
      await tx`select pg_advisory_xact_lock(7300, ${ano})`;
      const [ja] = await tx`select numero_tav from docs_recebimento where nota_id = ${notaId} and ano = ${ano} and doc in ('tav', 'ambos')
                            order by criado_em desc limit 1`;
      numero = ja ? (ja.numero_tav as number) : ((await tx`select coalesce(max(numero_tav), 0) + 1 as n from docs_recebimento where ano = ${ano}`)[0].n as number);
      d = { ...d, numero_tav: String(numero) };
    }
    const valores = await valoresDoc(u, n as never, d);
    const texto = doc === "tav" ? `TAV nº ${numeroTav(numero, ano)} emitido` : `Check-list da Contagem emitido (TAV nº ${numeroTav(numero, ano)})${(d.contagem ?? []).some((c) => c.discrepancia === "Sim") ? " · com discrepância" : ""}`;
    const [r] = await tx`insert into docs_recebimento (nota_id, numero_tav, ano, doc, dados, criado_por, criado_por_nome)
                         values (${notaId}, ${numero}, ${ano}, ${doc}, ${tx.json({ formulario: d, valores } as never)}, ${u.id}, ${u.nome}) returning id`;
    if (doc === "tav" && d.id_pa.trim()) await definirIdPa(tx, u, notaId, d.id_pa, `TAV nº ${numeroTav(numero, ano)}`);
    await tx`insert into eventos (nota_id, tipo, usuario_id, usuario_nome, texto) values (${notaId}, 'docs_recebimento', ${u.id}, ${u.nome}, ${texto})`;
    return r.id as number;
  });
}

export async function docsDaNota(notaId: number) {
  return sql<{ id: number; numero_tav: number; ano: number; doc: "tav" | "checklist" | "ambos"; criado_em: Date; por: string | null; dados: { formulario: DadosRecebimento } }[]>`
    select r.id, r.numero_tav, r.ano, r.doc, r.criado_em, coalesce(u.nome, r.criado_por_nome) as por, r.dados from docs_recebimento r left join usuarios u on u.id = r.criado_por
    where r.nota_id = ${notaId} order by r.criado_em desc`;
}

const MIME = { odt: "application/vnd.oasis.opendocument.text", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

const qtdBR = (v: number) => fmtNumero(v, Number.isInteger(v) ? 0 : 2);

/** Tabela da contagem: cada item (ou tamanho da grade) com o item do estoque, CXP e plano de caixas. */
export function tabelaContagem(linhas: LinhaCorrelacao[], volumesNf: number): Tabela {
  const tot = linhas.reduce((a, l) => ({ qtd: a.qtd + l.qtd, cheias: a.cheias + (l.caixas?.cheias ?? 0), frac: a.frac + (l.caixas?.fracionada ? 1 : 0), total: a.total + (l.caixas?.total ?? 0) }), { qtd: 0, cheias: 0, frac: 0, total: 0 });
  const pendentes = linhas.filter((l) => !l.item || !l.caixas || l.confianca === "media").length;
  return {
    titulo: "RELAÇÃO DE ITENS PARA CONTAGEM",
    colunas: [
      { titulo: "#", cm: 0.7, alinhar: "centro" },
      { titulo: "PI", cm: 1.7, alinhar: "centro" },
      { titulo: "ITEM NO ESTOQUE (WMS)", cm: 6.0 },
      { titulo: "QTD. NF", cm: 1.4, alinhar: "dir" },
      { titulo: "CXP", cm: 1.0, alinhar: "dir" },
      { titulo: "CX. CHEIAS", cm: 1.2, alinhar: "dir" },
      { titulo: "FRACION.", cm: 1.5, alinhar: "dir" },
      { titulo: "TOTAL CX.", cm: 1.1, alinhar: "dir" },
      { titulo: "QTD. CONTADA", cm: 1.6 },
      { titulo: "CX. CONTADAS", cm: 1.8 },
    ],
    linhas: linhas.map((l) => [
      String(l.n),
      l.item?.pi ?? "—",
      l.item ? `${l.confianca === "media" ? "VERIFICAR: " : ""}${l.item.descricao}` : `SEM CORRELAÇÃO — ${l.descricao.length > 80 ? l.descricao.slice(0, 78) + "…" : l.descricao}`,
      `${qtdBR(l.qtd)} ${l.un}`.trim(),
      l.item?.cxp ? qtdBR(l.item.cxp) : "—",
      l.caixas ? String(l.caixas.cheias) : "—",
      l.caixas?.fracionada ? `1 c/ ${qtdBR(l.caixas.fracionada)}` : "—",
      l.caixas ? String(l.caixas.total) : "—",
      "",
      "",
    ]),
    rodape: ["", "", "TOTAL", qtdBR(tot.qtd), "", String(tot.cheias), tot.frac ? String(tot.frac) : "—", String(tot.total), "", ""],
    nota:
      `Volumes informados na NF: ${volumesNf || "—"}. Caixas calculadas pelo padrão (CXP) do estoque.` +
      (pendentes ? ` ${pendentes} linha(s) sem correlação, sem CXP ou a verificar: conferir item e quantidade de caixas na contagem.` : ""),
  };
}

const volumesDaNota = (dados: DadosNF | null) => (dados?.transp?.volumes ?? []).reduce((s, v) => s + (Number(v.qVol) || 0), 0);

/** Gera o TAV ou o Check-list de um registro, com o modelo atual. Quem imprime assina como responsável pelo pré-recebimento. */
export async function documentoRecebimento(id: number, doc: "tav" | "checklist", quemImprime: Usuario, formato: "pdf" | "modelo" = "pdf") {
  const [r] = await sql`select r.dados, r.numero_tav, r.ano, r.doc, r.nota_id, n.numero, n.emit_cnpj, n.itens, n.dados as nf
                        from docs_recebimento r join notas n on n.id = r.nota_id where r.id = ${id}`;
  if (!r || (r.doc !== "ambos" && r.doc !== doc)) return null;
  const prefixo = doc === "tav" ? "TAV" : "Check-list";
  const base = `${prefixo}-${String(r.numero_tav).padStart(4, "0")}-${r.ano}-NF${String(r.numero).replace(/\W/g, "")}`;
  const valores = { ...(r.dados as { valores: Record<string, string> }).valores, numero_tav: String(r.numero_tav).padStart(4, "0"), responsavel: quemImprime.nome };
  let tabela: Tabela | null = null;
  if (doc === "tav") {
    const { linhas } = await correlacionarNota({ emit_cnpj: r.emit_cnpj, itens: r.itens as ItemNF[] | null });
    if (linhas.length) tabela = tabelaContagem(linhas, volumesDaNota(r.nf as DadosNF | null));
  }
  if (formato === "pdf") {
    const ids = { registro: id, nota: r.nota_id as number };
    const contagem = (r.dados as { formulario: DadosRecebimento }).formulario.contagem ?? [];
    const bytes = doc === "tav" ? await pdfTav(valores, tabela, ids) : await pdfChecklist(valores, ids, contagem);
    return { bytes, nome: `${base}.pdf`, mime: "application/pdf" };
  }
  const { arquivo, nome } = await modeloAtual(doc);
  const ext = /\.docx$/i.test(nome) ? "docx" : "odt";
  const modelo: Uint8Array = tabela ? inserirTabela(arquivo, "{{tabela_itens}}", tabela) : arquivo;
  return { bytes: preencherDocx(modelo, valores), nome: `${base}.${ext}`, mime: MIME[ext] };
}

/** Exemplo preenchido com dados fictícios, para conferir um modelo. */
export async function exemploRecebimento(doc: "tav" | "checklist") {
  const [{ arquivo }, fixos] = await Promise.all([modeloAtual(doc), camposFixos()]);
  const v: Record<string, string> = {
    numero_nf: "12345", numero_oc: "1180000", nome_empresa: "EMPRESA EXEMPLO LTDA", cnpj: "00.000.000/0001-00", responsavel: "Nome do responsável",
    numero_tav: "0001", ano: String(new Date().getFullYear()), data_recebimento: new Date().toLocaleDateString("pt-BR"), id_pa: "950000",
    lote: "LOTE 01", fabricacao: "10/2026", volumes: "10 caixas", observacao: "Observação de exemplo.", x_contagem: "X", x_pesagem: "",
    ...Object.fromEntries(PERGUNTAS_TAV.flatMap((_, i) => [[`q${i + 1}_sim`, "X"], [`q${i + 1}_nao`, ""]])),
    peso_kg: "12,5", itens_caixa: "50", data_envio_amostra: new Date().toLocaleDateString("pt-BR"), obs_recebimento: "Amostra enviada.",
    discrepancia_sim: "", discrepancia_nao: "X", obs_contagem: "Sem discrepâncias.",
    ...Object.fromEntries(fixos.map((f) => [f.chave, f.valor])),
  };
  const ext = /\.docx$/i.test((await modeloAtual(doc)).nome) ? "docx" : "odt";
  const exemplo = (n: number, pi: string, descricao: string, q: number, cxp: number | null): LinhaCorrelacao => {
    const caixas = cxp ? { cheias: Math.floor(q / cxp), fracionada: q % cxp, total: Math.ceil(q / cxp) } : null;
    return { ref: String(n), n, codigo: "", descricao, qtd: q, un: "UN", confianca: "alta", item: { pi, descricao, cxp }, candidatos: [], caixas };
  };
  const modelo = doc === "tav"
    ? inserirTabela(arquivo, "{{tabela_itens}}", tabelaContagem([exemplo(1, "190000001", "ITEM DE EXEMPLO TAM P", 101, 20), exemplo(2, "190000002", "ITEM DE EXEMPLO TAM M", 300, 50)], 13))
    : arquivo;
  return { bytes: preencherDocx(modelo, v), ext, mime: MIME[ext] };
}

// ------------------------------------------------------------------ minuta do TAV (Pré Recebimento)

/** Etapa do Pré Recebimento: a primeira que emite os documentos do Recebimento. */
export function etapaPreRecebimento(etapas: Etapa[]) {
  return etapas.find((e) => e.emite_docs_recebimento && /pr[eé].?receb/i.test(`${e.nome} ${e.setor}`)) ?? etapas.find((e) => e.emite_docs_recebimento) ?? null;
}

/** Só quem atua no Pré Recebimento (ou o administrador geral), com a NF nessa etapa. */
export function podeMinutaTav(u: Usuario, etapas: Etapa[], nota: { status: string; etapa_id: number | null }) {
  const pre = etapaPreRecebimento(etapas);
  if (!pre || nota.status !== "em_tramite" || nota.etapa_id !== pre.id) return false;
  return u.papel === "admin" || (u.papel === "interno" && etapasDoUsuario(u, etapas).some((e) => e.id === pre.id));
}

/** Minuta do TAV: dados da NF e a relação de itens para conferir no recebimento. Não registra nada. */
export async function minutaTav(u: Usuario, notaId: number) {
  const [n] = await sql`select id, numero, oc, emit_nome, emit_cnpj, id_pa, itens, dados from notas where id = ${notaId}`;
  if (!n) return null;
  const vols = ((n.dados as DadosNF | null)?.transp?.volumes ?? []).map((v) => [v.qVol, v.esp].filter(Boolean).join(" ")).filter(Boolean).join(" + ");
  const valores: Record<string, string> = {
    numero_nf: n.numero as string, numero_oc: (n.oc as string | null) ?? "", nome_empresa: n.emit_nome as string, cnpj: cnpj(n.emit_cnpj as string),
    responsavel: u.nome, numero_tav: "MINUTA", ano: "", data_recebimento: "   /   /      ", id_pa: (n.id_pa as string | null) ?? "",
    volumes: vols ? `${vols} (conforme a NF)` : "", observacao: "", x_contagem: "", x_pesagem: "",
  };
  const { linhas } = await correlacionarNota({ emit_cnpj: n.emit_cnpj as string, itens: n.itens as ItemNF[] | null });
  const tabela = linhas.length ? tabelaContagem(linhas, volumesDaNota(n.dados as DadosNF | null)) : null;
  const bytes = await pdfTav(valores, tabela, { registro: 0, nota: notaId }, true);
  return { bytes, nome: `Minuta-TAV-NF${String(n.numero).replace(/\W/g, "")}.pdf` };
}
