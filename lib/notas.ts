import "server-only";
import { sql } from "./db";
import { ehInterno, podeCadastrar, type Usuario } from "./auth";
import { etapasAtivas, registrarEvento } from "./fluxo";
import { lerPdfPortal } from "./nfe-pdf";
import { lerNFe, textoBusca, type DadosNF, type ItemNF, type NFLida } from "./nfe";
import { soDigitos } from "./format";

export type NotaLista = {
  id: number; chave: string | null; numero: string; serie: string | null; emit_cnpj: string; emit_nome: string; valor: string;
  oc: string | null; status: string; etapa_id: number | null; etapa_nome: string | null; prazo_dias: number | null;
  recebida_em: Date; concluida_em: Date | null; etapa_desde: Date; arrecadada_em: Date | null; armazenada_em: Date | null;
  tem_xml: boolean; fonte: string | null; sob_medida: boolean; dias_etapa: number; dias_arrecadada: number | null; dias_total: number; ultima_obs: string | null; obs_oc: string | null; n_comentarios?: number; id_pa: string | null; exige_id_pa: boolean;
};

export type Nota = NotaLista & {
  empenho: string | null; data_emissao: Date | null; natureza: string | null; reprov_visual: string | null;
  reprov_laboratorial: string | null; dados: DadosNF | null; itens: ItemNF[] | null; origem: string;
};

/** Regra central de isolamento: empresa só enxerga NF do próprio CNPJ. */
export function visivel(u: Usuario) {
  return ehInterno(u) ? sql`true` : sql`n.emit_cnpj = ${u.empresa_cnpj ?? "-"}`;
}

const COLUNAS = sql`
  n.id, n.chave, n.numero, n.serie, n.emit_cnpj, n.emit_nome, n.valor, n.oc, n.status, n.etapa_id, e.nome as etapa_nome,
  e.prazo_dias, n.recebida_em, n.concluida_em, n.etapa_desde, n.arrecadada_em, n.armazenada_em, n.tem_xml, n.fonte, n.sob_medida, n.obs_oc, n.id_pa, n.exige_id_pa,
  extract(epoch from (now() - n.etapa_desde)) / 86400 as dias_etapa,
  extract(epoch from (now() - n.arrecadada_em)) / 86400 as dias_arrecadada,
  extract(epoch from (coalesce(n.concluida_em, now()) - n.recebida_em)) / 86400 as dias_total`;

const ULTIMA_OBS = sql`(select ev.texto from eventos ev where ev.nota_id = n.id and ev.texto is not null and ev.tipo <> 'ciente' order by ev.criado_em desc, ev.id desc limit 1) as ultima_obs`;

export type Filtros = {
  q?: string; situacao?: string; cnpj?: string; de?: string; ate?: string; vmin?: string; vmax?: string;
  atrasadas?: string; xml?: string; pagina?: string;
};

export const POR_PAGINA = 50;
const dataValida = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
const numValido = (s?: string) => (s && !isNaN(Number(s.replace(",", "."))) ? Number(s.replace(",", ".")) : null);

function condicoes(u: Usuario, f: Filtros, prazoReprov: number) {
  const c = [visivel(u)];
  for (const termo of (f.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)) {
    const t = "%" + termo.replace(/[\\%_]/g, "\\$&") + "%";
    const d = soDigitos(termo);
    c.push(d.length >= 3 && d !== termo ? sql`(n.busca like ${t} or n.busca like ${"%" + d + "%"} or n.id_pa = ${termo})` : sql`(n.busca like ${t} or n.id_pa = ${termo})`);
  }
  const s = f.situacao ?? "";
  if (s.startsWith("etapa:")) c.push(sql`n.status = 'em_tramite' and n.etapa_id = ${Number(s.slice(6)) || 0}`);
  else if (s === "concluidas") c.push(sql`n.status in ('finalizada','retirada','arquivada')`);
  else if (["em_tramite", "reprovada", "finalizada", "retirada", "arquivada"].includes(s)) c.push(sql`n.status = ${s}`);
  if (f.cnpj && ehInterno(u)) c.push(sql`n.emit_cnpj = ${soDigitos(f.cnpj)}`);
  const de = dataValida(f.de), ate = dataValida(f.ate);
  if (de) c.push(sql`n.recebida_em >= (${de}::date)::timestamp at time zone 'America/Sao_Paulo'`);
  if (ate) c.push(sql`n.recebida_em < (${ate}::date + 1)::timestamp at time zone 'America/Sao_Paulo'`);
  const vmin = numValido(f.vmin), vmax = numValido(f.vmax);
  if (vmin !== null) c.push(sql`n.valor >= ${vmin}`);
  if (vmax !== null) c.push(sql`n.valor <= ${vmax}`);
  if (f.atrasadas === "1")
    c.push(sql`((n.status = 'em_tramite' and now() - n.etapa_desde > make_interval(days => e.prazo_dias))
             or (n.status = 'reprovada' and now() - n.etapa_desde > make_interval(days => ${prazoReprov})))`);
  if (f.xml === "sim") c.push(sql`n.fonte is not null`);
  if (f.xml === "nao") c.push(sql`n.fonte is null`);
  return c.reduce((a, b) => sql`${a} and ${b}`);
}

export async function buscarNotas(u: Usuario, f: Filtros, prazoReprov: number, todas = false) {
  const onde = condicoes(u, f, prazoReprov);
  const pagina = Math.max(1, Number(f.pagina) || 1);
  const [linhas, [tot]] = await Promise.all([
    sql<NotaLista[]>`select ${COLUNAS}, null as ultima_obs from notas n left join etapas e on e.id = n.etapa_id
        where ${onde} order by n.recebida_em desc, n.id desc
        ${todas ? sql`limit 5000` : sql`limit ${POR_PAGINA} offset ${(pagina - 1) * POR_PAGINA}`}`,
    sql`select count(*)::int as total, coalesce(sum(n.valor), 0) as valor from notas n left join etapas e on e.id = n.etapa_id where ${onde}`,
  ]);
  return { linhas, total: tot.total as number, valorTotal: tot.valor as string, pagina };
}

/** Fila de trabalho: NF em uma etapa, as reprovadas, ou as que aguardam armazenagem. */
export async function fila(tipo: { etapa: number } | "reprovadas" | "armazenar") {
  const onde =
    tipo === "reprovadas" ? sql`n.status = 'reprovada'`
    : tipo === "armazenar" ? sql`n.arrecadada_em is not null and n.armazenada_em is null and n.status in ('em_tramite','finalizada')`
    : sql`n.status = 'em_tramite' and n.etapa_id = ${tipo.etapa}`;
  return sql<NotaLista[]>`select ${COLUNAS}, ${ULTIMA_OBS},
      (select count(*)::int from eventos ev where ev.nota_id = n.id and ev.texto is not null and ev.tipo <> 'ciente') as n_comentarios from notas n left join etapas e on e.id = n.etapa_id
      where ${onde} order by n.recebida_em asc, n.id asc limit 1000`; // ordem de chegada: quem chegou primeiro é atendido primeiro em todas as etapas
}

export async function contagemFilas() {
  const linhas = await sql`
    select 'e' || etapa_id as k, count(*)::int as n from notas where status = 'em_tramite' group by etapa_id
    union all select 'reprovadas', count(*)::int from notas where status = 'reprovada'
    union all select 'armazenar', count(*)::int from notas where arrecadada_em is not null and armazenada_em is null and status in ('em_tramite','finalizada')`;
  return Object.fromEntries(linhas.map((l) => [l.k, l.n])) as Record<string, number>;
}

export async function obterNota(u: Usuario, id: number): Promise<Nota | null> {
  if (!Number.isInteger(id)) return null;
  const [n] = await sql<Nota[]>`select ${COLUNAS}, null as ultima_obs, n.empenho, n.data_emissao, n.natureza, n.reprov_visual,
      n.reprov_laboratorial, n.dados, n.itens, n.origem
    from notas n left join etapas e on e.id = n.etapa_id where n.id = ${id} and ${visivel(u)}`;
  return n ?? null;
}

export type Evento = {
  id: number; tipo: string; movimento: boolean; de_nome: string | null; para_nome: string | null; para_status: string | null;
  para_etapa_id: number | null; usuario_nome: string | null; texto: string | null; criado_em: Date; marcados: string | null;
};

export async function eventosDaNota(notaId: number) {
  return sql<Evento[]>`select id, tipo, movimento, de_nome, para_nome, para_status, para_etapa_id, usuario_nome, texto, criado_em, marcados
                       from eventos where nota_id = ${notaId} order by criado_em, id`;
}

export async function xmlDaNota(u: Usuario, id: number) {
  const [r] = await sql`select x.xml, n.chave, n.numero from nota_xml x join notas n on n.id = x.nota_id where n.id = ${id} and ${visivel(u)}`;
  return r as { xml: string; chave: string | null; numero: string } | undefined;
}

export async function listarEmpresas() {
  return sql<{ cnpj: string; nome: string }[]>`select cnpj, nome from empresas order by nome`;
}

async function garantirEmpresa(db: typeof sql, cnpj: string, nome: string) {
  await db`insert into empresas (cnpj, nome) values (${cnpj}, ${nome}) on conflict (cnpj) do nothing`;
}

async function etapaInicial(sobMedida: boolean) {
  const etapas = await etapasAtivas();
  if (!etapas.length) throw new Error("Nenhuma etapa configurada. Peça ao administrador para definir o caminho.");
  return (sobMedida && etapas.find((e) => e.entrada_sob_medida)) || etapas[0];
}

export type Documento = { tipo: "xml" | "pdf"; conteudo: string }; // PDF vem em base64
export type PreviaXml = { nf: NFLida; existente: { id: number; tem_xml: boolean; fonte: string | null; oc: string | null } | null; bloqueio: string | null };

/** Lê o XML da NF-e ou o PDF da consulta do Portal da NF-e e verifica se a nota já existe. */
export async function analisarDocumento(doc: Documento): Promise<PreviaXml> {
  const nf = doc.tipo === "pdf" ? await lerPdfPortal(new Uint8Array(Buffer.from(doc.conteudo, "base64"))) : lerNFe(doc.conteudo);
  const [existente] = await sql`select id, tem_xml, fonte, oc from notas where chave = ${nf.chave}
                                order by (status in ('em_tramite','reprovada')) desc, id desc limit 1`;
  const e = (existente as PreviaXml["existente"]) ?? null;
  const bloqueio = !e ? null
    : e.tem_xml ? `NF ${nf.numero} já está cadastrada com XML.`
    : doc.tipo === "pdf" && e.fonte ? `NF ${nf.numero} já está cadastrada com os dados da consulta.`
    : null;
  return { nf, existente: e, bloqueio };
}

/** Cadastra a NF a partir do XML ou do PDF; se a chave já existir sem esses dados, apenas os anexa à NF existente. */
export async function cadastrarPorDocumento(u: Usuario, doc: Documento, op: { oc?: string; sobMedida?: boolean; obs?: string }) {
  if (!podeCadastrar(u)) throw new Error("Seu perfil não permite cadastrar NF.");
  const { nf, existente, bloqueio } = await analisarDocumento(doc);
  if (bloqueio) throw new Error(bloqueio);
  const xml = doc.tipo === "xml" ? doc.conteudo : null;
  const oc = op.oc?.trim() || nf.oc || existente?.oc || null;
  if (!oc) throw new Error(`NF ${nf.numero}: a nota não traz o número da OC. Digite a OC para cadastrar.`);
  const busca = textoBusca({ ...nf, oc });

  if (existente) {
    await sql.begin(async (tx) => {
      await tx`update notas set serie = ${nf.serie}, data_emissao = ${nf.data_emissao}, natureza = ${nf.natureza}, empenho = coalesce(${nf.empenho || null}, empenho),
                 oc = coalesce(oc, ${oc}), dados = ${tx.json(nf.dados as never)}, itens = ${tx.json(nf.itens as never)}, tem_xml = ${!!xml}, fonte = ${doc.tipo},
                 busca = ${busca} || ' ' || coalesce(oc, '') where id = ${existente.id}`;
      if (xml) await tx`insert into nota_xml (nota_id, xml, enviado_por) values (${existente.id}, ${xml}, ${u.id})`;
      await registrarEvento(tx, { nota_id: existente.id, tipo: "xml", usuario: u, texto: xml ? "XML da NF-e anexado" : "Dados da NF-e anexados (PDF da consulta no Portal da NF-e)" });
    });
    return { id: existente.id, numero: nf.numero, anexado: true };
  }

  const etapa = await etapaInicial(!!op.sobMedida);
  const id = await sql.begin(async (tx) => {
    await garantirEmpresa(tx as never, nf.emit_cnpj, nf.emit_nome);
    const [n] = await tx`insert into notas (chave, numero, serie, emit_cnpj, emit_nome, valor, oc, empenho, data_emissao, natureza, sob_medida,
                           status, etapa_id, tem_xml, fonte, dados, itens, busca, criado_por)
        values (${nf.chave}, ${nf.numero}, ${nf.serie}, ${nf.emit_cnpj}, ${nf.emit_nome}, ${nf.valor}, ${oc}, ${nf.empenho || null}, ${nf.data_emissao},
                ${nf.natureza}, ${!!op.sobMedida}, 'em_tramite', ${etapa.id}, ${!!xml}, ${doc.tipo}, ${tx.json(nf.dados as never)}, ${tx.json(nf.itens as never)}, ${busca}, ${u.id})
        returning id`;
    if (xml) await tx`insert into nota_xml (nota_id, xml, enviado_por) values (${n.id}, ${xml}, ${u.id})`;
    await registrarEvento(tx, { nota_id: n.id, tipo: "cadastro", movimento: true, de_nome: "Cadastro", para_etapa_id: etapa.id, para_status: "em_tramite", para_nome: etapa.nome, usuario: u, texto: op.obs });
    return n.id as number;
  });
  return { id, numero: nf.numero, anexado: false };
}

/** Cadastro manual (documentos sem XML). */
export async function cadastrarManual(
  u: Usuario,
  d: { chave?: string; numero: string; cnpj: string; nome: string; valor: number; oc?: string; sobMedida?: boolean; obs?: string },
) {
  if (!podeCadastrar(u)) throw new Error("Seu perfil não permite cadastrar NF.");
  const cnpj = soDigitos(d.cnpj);
  const chave = d.chave?.trim() ? (soDigitos(d.chave).length === 44 ? soDigitos(d.chave) : d.chave.trim()) : null;
  if (!d.numero.trim() || !cnpj || !d.nome.trim()) throw new Error("Preencha número, CNPJ e nome da empresa.");
  if (!d.oc?.trim()) throw new Error("Informe a OC (ordem de compra) da NF.");
  if (!(d.valor >= 0)) throw new Error("Valor inválido.");
  if (chave) {
    const [dup] = await sql`select id from notas where chave = ${chave} limit 1`;
    if (dup) throw new Error("Já existe uma NF cadastrada com esta chave de acesso.");
  }
  const etapa = await etapaInicial(!!d.sobMedida);
  const nota = { numero: d.numero.trim(), chave, emit_nome: d.nome.trim(), emit_cnpj: cnpj, oc: d.oc?.trim() || null };
  return sql.begin(async (tx) => {
    await garantirEmpresa(tx as never, cnpj, nota.emit_nome);
    const [n] = await tx`insert into notas (chave, numero, emit_cnpj, emit_nome, valor, oc, sob_medida, status, etapa_id, busca, criado_por)
        values (${chave}, ${nota.numero}, ${cnpj}, ${nota.emit_nome}, ${d.valor}, ${nota.oc}, ${!!d.sobMedida}, 'em_tramite', ${etapa.id}, ${textoBusca(nota)}, ${u.id})
        returning id`;
    await registrarEvento(tx, { nota_id: n.id, tipo: "cadastro", movimento: true, de_nome: "Cadastro", para_etapa_id: etapa.id, para_status: "em_tramite", para_nome: etapa.nome, usuario: u, texto: d.obs });
    return n.id as number;
  });
}
