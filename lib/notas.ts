import "server-only";
import { classificarNF, type TipoNF } from "./tipo-nf";
import { sql } from "./db";
import { ehInterno, podeCadastrar, type Usuario } from "./auth";
import { etapasAtivas, registrarEvento } from "./fluxo";
import { extrairLinhas, lerPdfPortal } from "./nfe-pdf";
import { lerDanfe, TAMANHO_MAX_DANFE, textoEhDanfe } from "./nfe-danfe";
import { lerNFe, textoBusca, type DadosNF, type ItemNF, type NFLida } from "./nfe";
import { soDigitos } from "./format";

export type NotaLista = {
  id: number; chave: string | null; numero: string; serie: string | null; emit_cnpj: string; emit_nome: string; valor: string;
  oc: string | null; status: string; etapa_id: number | null; etapa_nome: string | null; prazo_dias: number | null;
  recebida_em: Date; concluida_em: Date | null; etapa_desde: Date; arrecadada_em: Date | null; armazenada_em: Date | null;
  tem_xml: boolean; fonte: string | null; sob_medida: boolean; dias_etapa: number; dias_arrecadada: number | null; dias_total: number; ultima_obs: string | null; obs_oc: string | null; n_comentarios?: number; n_docs?: number; docs_faltando?: string | null; id_pa: string | null; exige_id_pa: boolean; indicacao_reprovacao: "pericia" | "tecnica" | null; tipo_nf: TipoNF; tipo_nf_motivo: string | null; parcial: boolean; parcial_motivo: string | null; categoria: Categoria;
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
  e.prazo_dias, n.recebida_em, n.concluida_em, n.etapa_desde, n.arrecadada_em, n.armazenada_em, n.tem_xml, n.fonte, n.sob_medida, n.obs_oc, n.id_pa, n.exige_id_pa, n.indicacao_reprovacao, n.tipo_nf, n.tipo_nf_motivo, n.parcial, n.parcial_motivo, n.categoria,
  extract(epoch from (now() - n.etapa_desde)) / 86400 as dias_etapa,
  extract(epoch from (now() - n.arrecadada_em)) / 86400 as dias_arrecadada,
  extract(epoch from (coalesce(n.concluida_em, now()) - n.recebida_em)) / 86400 as dias_total`;

// último comentário de usuário (as mensagens automáticas do sistema ficam só no histórico)
const ULTIMA_OBS = sql`(select ev.texto from eventos ev where ev.nota_id = n.id and ev.comentario order by ev.criado_em desc, ev.id desc limit 1) as ultima_obs`;

export type Filtros = {
  q?: string; situacao?: string; cnpj?: string; de?: string; ate?: string; vmin?: string; vmax?: string;
  atrasadas?: string; xml?: string; pagina?: string; categoria?: string;
};

/** NF ou Mapa de devolução (devolução de material dos CAM, com trâmite separado). */
export type Categoria = "nf" | "mapa";
export const categoriaValida = (v: unknown): Categoria => (v === "mapa" ? "mapa" : "nf");

export const POR_PAGINA = 50;
const dataValida = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
const numValido = (s?: string) => (s && !isNaN(Number(s.replace(",", "."))) ? Number(s.replace(",", ".")) : null);

function condicoes(u: Usuario, f: Filtros, prazoReprov: number) {
  // a pesquisa de notas é só de NF; os mapas de devolução têm a lista própria
  const c = [visivel(u), sql`n.categoria = ${f.categoria === "mapa" ? "mapa" : "nf"}`];
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
export async function fila(tipo: { etapa: number } | "reprovadas" | "armazenar", categoria: Categoria = "nf") {
  const onde0 =
    tipo === "reprovadas" ? sql`n.status = 'reprovada'`
    : tipo === "armazenar" ? sql`n.arrecadada_em is not null and n.armazenada_em is null and n.status in ('em_tramite','finalizada')`
    : sql`n.status = 'em_tramite' and n.etapa_id = ${tipo.etapa}`;
  const onde = sql`${onde0} and n.categoria = ${categoria}`;
  return sql<NotaLista[]>`select ${COLUNAS}, ${ULTIMA_OBS},
      (select count(*)::int from eventos ev where ev.nota_id = n.id and ev.comentario) as n_comentarios,
      (select count(*)::int from documentos d where d.nota_id = n.id and d.removido_em is null) as n_docs,
      (select string_agg(t.nome, ', ' order by t.ordem) from etapa_documentos ed join tipos_documento t on t.id = ed.tipo_id and t.ativo
        where n.status = 'em_tramite' and ed.etapa_id = n.etapa_id and not exists (
          select 1 from documentos d where d.nota_id = n.id and d.tipo_id = ed.tipo_id and d.removido_em is null
            and (not t.exige_assinatura or exists (select 1 from jsonb_array_elements(d.assinaturas) a where (a->>'integra')::boolean)))) as docs_faltando
      from notas n left join etapas e on e.id = n.etapa_id
      where ${onde} order by n.recebida_em asc, n.id asc limit 1000`; // ordem de chegada: quem chegou primeiro é atendido primeiro em todas as etapas
}

export async function contagemFilas(categoria: Categoria = "nf") {
  const linhas = await sql`
    select 'e' || etapa_id as k, count(*)::int as n from notas where status = 'em_tramite' and categoria = ${categoria} group by etapa_id
    union all select 'reprovadas', count(*)::int from notas where status = 'reprovada' and categoria = ${categoria}
    union all select 'armazenar', count(*)::int from notas where arrecadada_em is not null and armazenada_em is null and status in ('em_tramite','finalizada') and categoria = ${categoria}`;
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
  para_etapa_id: number | null; usuario_nome: string | null; texto: string | null; criado_em: Date; marcados: string | null; comentario: boolean;
};

export async function eventosDaNota(notaId: number) {
  return sql<Evento[]>`select id, tipo, movimento, de_nome, para_nome, para_status, para_etapa_id, usuario_nome, texto, criado_em, marcados, comentario
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
export type Origem = "xml" | "pdf" | "danfe";
export type PreviaXml = {
  nf: NFLida; existente: { id: number; tem_xml: boolean; fonte: string | null; oc: string | null } | null; bloqueio: string | null;
  tipo: TipoNF; motivo: string; origem: Origem;
};

/** PDF: DANFE (gerada pela chave de acesso) ou consulta completa do Portal da NF-e. */
async function lerPdf(bytes: Uint8Array): Promise<{ nf: NFLida; origem: Origem }> {
  if (!bytes.length || bytes.length > TAMANHO_MAX_DANFE) throw new Error("Arquivo vazio ou maior que 3 MB.");
  let linhas;
  try {
    linhas = await extrairLinhas(new Uint8Array(bytes)); // cópia: a leitura consome o buffer
  } catch {
    throw new Error("Não foi possível abrir o PDF.");
  }
  if (linhas.length < 10)
    throw new Error("Este PDF não tem texto (parece digitalizado). Baixe a DANFE pela chave de acesso; se não conseguir, use o cadastro manual com a NF digitalizada.");
  if (textoEhDanfe(linhas)) return { nf: await lerDanfe(bytes, linhas), origem: "danfe" };
  return { nf: await lerPdfPortal(bytes), origem: "pdf" };
}

/** Lê o XML da NF-e, a DANFE em PDF ou o PDF da consulta do Portal da NF-e e verifica se a nota já existe. */
export async function analisarDocumento(doc: Documento): Promise<PreviaXml> {
  const { nf, origem } = doc.tipo === "pdf" ? await lerPdf(new Uint8Array(Buffer.from(doc.conteudo, "base64"))) : { nf: lerNFe(doc.conteudo), origem: "xml" as const };
  const [existente] = await sql`select id, tem_xml, fonte, oc from notas where chave = ${nf.chave}
                                order by (status in ('em_tramite','reprovada')) desc, id desc limit 1`;
  const e = (existente as PreviaXml["existente"]) ?? null;
  const bloqueio = !e ? null
    : e.tem_xml ? `NF ${nf.numero} já está cadastrada com XML.`
    : doc.tipo === "pdf" && e.fonte ? `NF ${nf.numero} já está cadastrada com os dados da consulta.`
    : null;
  return { nf, existente: e, bloqueio, ...classificarNF(nf), origem };
}

/** Cadastra a NF a partir do XML ou do PDF; se a chave já existir sem esses dados, apenas os anexa à NF existente. */
export async function cadastrarPorDocumento(u: Usuario, doc: Documento, op: { oc?: string; sobMedida?: boolean; obs?: string; tipoNf?: TipoNF }) {
  if (!podeCadastrar(u)) throw new Error("Seu perfil não permite cadastrar NF.");
  const { nf, existente, bloqueio, tipo: tipoLido, motivo: motivoLido, origem } = await analisarDocumento(doc);
  // o tipo identificado pelo CFOP pode ser corrigido por quem cadastra
  const tipoNf: TipoNF = op.tipoNf === "servico" || op.tipoNf === "material" ? op.tipoNf : tipoLido;
  const motivo = tipoNf === tipoLido ? motivoLido : `definido no cadastro por ${u.nome}`;
  if (bloqueio) throw new Error(bloqueio);
  const xml = doc.tipo === "xml" ? doc.conteudo : null;
  const oc = op.oc?.trim() || nf.oc || existente?.oc || null;
  if (!oc) throw new Error(`NF ${nf.numero}: a nota não traz o número da OC. Digite a OC para cadastrar.`);
  const busca = textoBusca({ ...nf, oc });

  if (existente) {
    await sql.begin(async (tx) => {
      await tx`update notas set serie = ${nf.serie}, data_emissao = ${nf.data_emissao}, natureza = ${nf.natureza}, empenho = coalesce(${nf.empenho || null}, empenho),
                 tipo_nf = ${tipoNf}, tipo_nf_motivo = ${motivo},
                 oc = coalesce(oc, ${oc}), dados = ${tx.json(nf.dados as never)}, itens = ${tx.json(nf.itens as never)}, tem_xml = ${!!xml}, fonte = ${origem},
                 busca = ${busca} || ' ' || coalesce(oc, '') where id = ${existente.id}`;
      if (xml) await tx`insert into nota_xml (nota_id, xml, enviado_por) values (${existente.id}, ${xml}, ${u.id})`;
      await registrarEvento(tx, { nota_id: existente.id, tipo: "xml", usuario: u, texto: xml ? "XML da NF-e anexado" : origem === "danfe" ? "Dados da NF-e anexados (lidos do PDF da DANFE)" : "Dados da NF-e anexados (PDF da consulta no Portal da NF-e)" });
    });
    return { id: existente.id, numero: nf.numero, anexado: true, chave: nf.chave, origem };
  }

  const etapa = await etapaInicial(!!op.sobMedida);
  const id = await sql.begin(async (tx) => {
    await garantirEmpresa(tx as never, nf.emit_cnpj, nf.emit_nome);
    const [n] = await tx`insert into notas (chave, numero, serie, emit_cnpj, emit_nome, valor, oc, empenho, data_emissao, natureza, sob_medida,
                           status, etapa_id, tem_xml, fonte, dados, itens, busca, criado_por, tipo_nf, tipo_nf_motivo)
        values (${nf.chave}, ${nf.numero}, ${nf.serie}, ${nf.emit_cnpj}, ${nf.emit_nome}, ${nf.valor}, ${oc}, ${nf.empenho || null}, ${nf.data_emissao},
                ${nf.natureza}, ${!!op.sobMedida}, 'em_tramite', ${etapa.id}, ${!!xml}, ${origem}, ${tx.json(nf.dados as never)}, ${tx.json(nf.itens as never)}, ${busca}, ${u.id},
                ${tipoNf}, ${motivo})
        returning id`;
    if (xml) await tx`insert into nota_xml (nota_id, xml, enviado_por) values (${n.id}, ${xml}, ${u.id})`;
    await registrarEvento(tx, { nota_id: n.id, tipo: "cadastro", movimento: true, de_nome: "Cadastro", para_etapa_id: etapa.id, para_status: "em_tramite", para_nome: etapa.nome, usuario: u, texto: op.obs, comentario: true });
    return n.id as number;
  });
  return { id, numero: nf.numero, anexado: false, chave: nf.chave, origem };
}

/** Cadastro manual (documentos sem XML). */
export async function cadastrarManual(
  u: Usuario,
  d: { chave?: string; numero: string; cnpj: string; nome: string; valor: number; oc?: string; sobMedida?: boolean; obs?: string; tipoNf?: TipoNF },
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
    const [n] = await tx`insert into notas (chave, numero, emit_cnpj, emit_nome, valor, oc, sob_medida, status, etapa_id, busca, criado_por, tipo_nf, tipo_nf_motivo)
        values (${chave}, ${nota.numero}, ${cnpj}, ${nota.emit_nome}, ${d.valor}, ${nota.oc}, ${!!d.sobMedida}, 'em_tramite', ${etapa.id}, ${textoBusca(nota)}, ${u.id},
                ${d.tipoNf ?? "material"}, ${`definido no cadastro manual por ${u.nome}`})
        returning id`;
    await registrarEvento(tx, { nota_id: n.id, tipo: "cadastro", movimento: true, de_nome: "Cadastro", para_etapa_id: etapa.id, para_status: "em_tramite", para_nome: etapa.nome, usuario: u, texto: d.obs, comentario: true });
    return n.id as number;
  });
}

// ------------------------------------------------------------------ Mapas de devolução

/** Cadastra um Mapa de devolução (devolução de material de um CAM): entra na primeira etapa, no trâmite dos mapas. */
export async function cadastrarMapa(u: Usuario, d: { numero: string; cam: string; data: string; obs?: string }) {
  if (!podeCadastrar(u)) throw new Error("Seu perfil não permite cadastrar.");
  const numero = d.numero.trim().slice(0, 40), cam = d.cam.trim().slice(0, 200);
  if (!numero) throw new Error("Informe o número do mapa de devolução.");
  if (!cam) throw new Error("Informe o CAM (OM) que devolveu o material.");
  const dataMapa = /^\d{4}-\d{2}-\d{2}$/.test(d.data) ? new Date(`${d.data}T12:00:00-03:00`) : null;
  const [dup] = await sql`select id from notas where categoria = 'mapa' and numero = ${numero} and upper(emit_nome) = upper(${cam}) limit 1`;
  if (dup) throw new Error(`O mapa de devolução nº ${numero} do ${cam} já está cadastrado.`);
  const etapa = await etapaInicial(false);
  return sql.begin(async (tx) => {
    const [n] = await tx`insert into notas (numero, emit_cnpj, emit_nome, valor, data_emissao, status, etapa_id, busca, criado_por, categoria)
        values (${numero}, '', ${cam}, 0, ${dataMapa}, 'em_tramite', ${etapa.id}, ${`${numero} ${cam}`.toLowerCase()}, ${u.id}, 'mapa') returning id`;
    await registrarEvento(tx, { nota_id: n.id, tipo: "cadastro", movimento: true, de_nome: "Cadastro", para_etapa_id: etapa.id, para_status: "em_tramite",
      para_nome: etapa.nome, usuario: u, texto: d.obs?.trim() || null, comentario: !!d.obs?.trim() });
    return n.id as number;
  });
}

/** Lista dos mapas de devolução (em trâmite e concluídos), com pesquisa por número ou CAM. */
export async function listarMapas(f: { q?: string; situacao?: string }) {
  const c = [sql`n.categoria = 'mapa'`];
  for (const termo of (f.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6))
    c.push(sql`n.busca like ${"%" + termo.replace(/[\\%_]/g, "\\$&") + "%"}`);
  if (f.situacao === "abertos") c.push(sql`n.status in ('em_tramite', 'reprovada')`);
  else if (f.situacao === "concluidos") c.push(sql`n.status not in ('em_tramite', 'reprovada')`);
  const onde = c.reduce((a, b) => sql`${a} and ${b}`);
  return sql<NotaLista[]>`select ${COLUNAS}, ${ULTIMA_OBS} from notas n left join etapas e on e.id = n.etapa_id where ${onde}
                          order by (n.status in ('em_tramite','reprovada')) desc, n.recebida_em desc, n.id desc limit 500`;
}
