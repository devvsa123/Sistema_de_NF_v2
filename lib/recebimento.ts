import "server-only";
import { sql } from "./db";
import type { Usuario } from "./auth";
import { etapasDoUsuario, type Etapa } from "./fluxo";
import { cnpj } from "./format";
import { preencherDocx } from "./docx";
import { camposFixos, modeloAtual } from "./laudo";

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
  { chave: "responsavel", descricao: "Nome de quem emitiu", origem: "NF" },
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
  { chave: "lote", descricao: "Lote", origem: "Recebimento" },
  { chave: "fabricacao", descricao: "Fabricação", origem: "Recebimento" },
  { chave: "volumes", descricao: "Volumes", origem: "Recebimento" },
  { chave: "observacao", descricao: "Observação do TAV", origem: "Recebimento" },
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

export type DadosRecebimento = {
  numero_tav: string; data_recebimento: string; id_pa: string; lote: string; fabricacao: string; volumes: string;
  conferencia: string; respostas: string[]; observacao: string;
  peso_kg: string; itens_caixa: string; data_envio_amostra: string; obs_recebimento: string; discrepancia: string; obs_contagem: string;
};

/** Usuários das etapas marcadas (Pré Recebimento e Contagem), somente enquanto a NF está numa delas. */
/** Usuários das etapas marcadas e o administrador geral, sempre com a NF numa dessas etapas. */
export function podeEmitirRecebimento(u: Usuario, etapas: Etapa[], nota: { status: string; etapa_id: number | null }) {
  if ((u.papel !== "interno" && u.papel !== "admin") || nota.status !== "em_tramite") return false;
  return etapasDoUsuario(u, etapas).some((e) => e.emite_docs_recebimento && e.id === nota.etapa_id);
}

export function validarRecebimento(d: DadosRecebimento): string | null {
  if (!/^\d{1,6}$/.test(d.numero_tav.trim())) return "Informe o número do TAV (somente números).";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.data_recebimento)) return "Informe a data do recebimento.";
  if (d.conferencia !== "Contagem manual" && d.conferencia !== "Pesagem") return "Escolha se a conferência foi por contagem manual ou pesagem.";
  if (d.respostas.length !== PERGUNTAS_TAV.length || d.respostas.some((r) => r !== "Sim" && r !== "Não"))
    return "Responda SIM ou NÃO para todas as perguntas do TAV.";
  if (d.discrepancia !== "Sim" && d.discrepancia !== "Não") return "Informe se houve discrepância na contagem.";
  if (d.observacao.length > 600 || d.obs_recebimento.length > 300 || d.obs_contagem.length > 900) return "Observação longa demais para o espaço do documento.";
  return null;
}

const dataBR = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : "");

export async function proximoTav(ano: number) {
  const [r] = await sql`select coalesce(max(numero_tav), 0) + 1 as n from docs_recebimento where ano = ${ano}`;
  return r.n as number;
}

export async function emitirRecebimento(u: Usuario, notaId: number, d: DadosRecebimento) {
  const [n] = await sql`select id, numero, oc, emit_cnpj, emit_nome from notas where id = ${notaId}`;
  if (!n) throw new Error("NF não encontrada.");
  const ano = Number(d.data_recebimento.slice(0, 4));
  const numero = Number(d.numero_tav);
  const [usado] = await sql`select n.numero from docs_recebimento r join notas n on n.id = r.nota_id
                            where r.ano = ${ano} and r.numero_tav = ${numero} and r.nota_id <> ${notaId} limit 1`;
  if (usado) throw new Error(`O TAV nº ${numero}/${ano} já foi usado na NF ${usado.numero}.`);
  const x = (cond: boolean) => (cond ? "X" : "");
  const fixos = await camposFixos();
  const valores: Record<string, string> = {
    numero_nf: n.numero, numero_oc: n.oc ?? "", nome_empresa: n.emit_nome, cnpj: cnpj(n.emit_cnpj), responsavel: u.nome,
    numero_tav: String(numero), ano: String(ano), data_recebimento: dataBR(d.data_recebimento),
    id_pa: d.id_pa.trim(), lote: d.lote.trim(), fabricacao: d.fabricacao.trim(), volumes: d.volumes.trim(), observacao: d.observacao.trim() || "_________",
    x_contagem: x(d.conferencia === "Contagem manual"), x_pesagem: x(d.conferencia === "Pesagem"),
    ...Object.fromEntries(d.respostas.flatMap((r, i) => [[`q${i + 1}_sim`, x(r === "Sim")], [`q${i + 1}_nao`, x(r === "Não")]])),
    peso_kg: d.peso_kg.trim(), itens_caixa: d.itens_caixa.trim(), data_envio_amostra: dataBR(d.data_envio_amostra) || "   /   /    ",
    obs_recebimento: d.obs_recebimento.trim() || "_".repeat(49), discrepancia_sim: x(d.discrepancia === "Sim"), discrepancia_nao: x(d.discrepancia === "Não"),
    obs_contagem: d.obs_contagem.trim() || "_".repeat(80), // vazio: mantém a linha para preencher à mão
    ...Object.fromEntries(fixos.map((f) => [f.chave, f.valor])),
  };
  return sql.begin(async (tx) => {
    const [r] = await tx`insert into docs_recebimento (nota_id, numero_tav, ano, dados, criado_por, criado_por_nome)
                         values (${notaId}, ${numero}, ${ano}, ${tx.json({ formulario: d, valores } as never)}, ${u.id}, ${u.nome}) returning id`;
    await tx`insert into eventos (nota_id, tipo, usuario_id, usuario_nome, texto)
             values (${notaId}, 'docs_recebimento', ${u.id}, ${u.nome}, ${`TAV nº ${numero}/${ano} e Check-list de Recebimento emitidos`})`;
    return r.id as number;
  });
}

export async function docsDaNota(notaId: number) {
  return sql<{ id: number; numero_tav: number; ano: number; criado_em: Date; por: string | null; dados: { formulario: DadosRecebimento } }[]>`
    select r.id, r.numero_tav, r.ano, r.criado_em, coalesce(u.nome, r.criado_por_nome) as por, r.dados from docs_recebimento r left join usuarios u on u.id = r.criado_por
    where r.nota_id = ${notaId} order by r.criado_em desc`;
}

const MIME = { odt: "application/vnd.oasis.opendocument.text", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

/** Gera o TAV ou o Check-list de um registro, com o modelo atual. */
export async function documentoRecebimento(id: number, doc: "tav" | "checklist") {
  const [r] = await sql`select r.dados, r.numero_tav, r.ano, n.numero from docs_recebimento r join notas n on n.id = r.nota_id where r.id = ${id}`;
  if (!r) return null;
  const { arquivo, nome } = await modeloAtual(doc);
  const ext = /\.docx$/i.test(nome) ? "docx" : "odt";
  const prefixo = doc === "tav" ? "TAV" : "Check-list";
  return {
    bytes: preencherDocx(arquivo, (r.dados as { valores: Record<string, string> }).valores),
    nome: `${prefixo}-${r.numero_tav}-${r.ano}-NF${String(r.numero).replace(/\W/g, "")}.${ext}`,
    mime: MIME[ext],
  };
}

/** Exemplo preenchido com dados fictícios, para conferir um modelo. */
export async function exemploRecebimento(doc: "tav" | "checklist") {
  const [{ arquivo }, fixos] = await Promise.all([modeloAtual(doc), camposFixos()]);
  const v: Record<string, string> = {
    numero_nf: "12345", numero_oc: "1180000", nome_empresa: "EMPRESA EXEMPLO LTDA", cnpj: "00.000.000/0001-00", responsavel: "Nome do responsável",
    numero_tav: "1", ano: String(new Date().getFullYear()), data_recebimento: new Date().toLocaleDateString("pt-BR"), id_pa: "950000",
    lote: "LOTE 01", fabricacao: "10/2026", volumes: "10 caixas", observacao: "Observação de exemplo.", x_contagem: "X", x_pesagem: "",
    ...Object.fromEntries(PERGUNTAS_TAV.flatMap((_, i) => [[`q${i + 1}_sim`, "X"], [`q${i + 1}_nao`, ""]])),
    peso_kg: "12,5", itens_caixa: "50", data_envio_amostra: new Date().toLocaleDateString("pt-BR"), obs_recebimento: "Amostra enviada.",
    discrepancia_sim: "", discrepancia_nao: "X", obs_contagem: "Sem discrepâncias.",
    ...Object.fromEntries(fixos.map((f) => [f.chave, f.valor])),
  };
  const ext = /\.docx$/i.test((await modeloAtual(doc)).nome) ? "docx" : "odt";
  return { bytes: preencherDocx(arquivo, v), ext, mime: MIME[ext] };
}
