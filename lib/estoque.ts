import "server-only";
import { cache } from "react";
import { readSheet } from "read-excel-file/node";
import { sql } from "./db";
import type { Usuario } from "./auth";
import { caixas, chavesAprendizado, correlacionar, indexar, type Confianca, type ItemEstoque } from "./correlacao";
import type { ItemNF } from "./nfe";

// ------------------------------------------------------------------ configuração

export type ConfigWms = {
  repo: string; branch: string; planilhaEstoque: string; planilhaUz: string; locVirtual: string; exigirUz: boolean; tokenConfigurado: boolean;
};

export async function configWms(): Promise<ConfigWms> {
  const linhas = await sql`select chave, valor from config where chave in ('planilhas_repo','planilhas_branch','planilha_estoque','planilha_uz','loc_virtual','exigir_uz_alocadas')`;
  const c = Object.fromEntries(linhas.map((l) => [l.chave, l.valor as string]));
  return {
    repo: c.planilhas_repo || "DepfmrjAbastecimento/planilhas", branch: c.planilhas_branch || "main",
    planilhaEstoque: c.planilha_estoque || "controle-estoque.xlsx", planilhaUz: c.planilha_uz || "",
    locVirtual: (c.loc_virtual || "REC").toUpperCase(), exigirUz: c.exigir_uz_alocadas === "sim",
    tokenConfigurado: !!process.env.PLANILHAS_GITHUB_TOKEN,
  };
}

export async function salvarConfigWms(c: Partial<Record<"planilhas_repo" | "planilhas_branch" | "planilha_estoque" | "planilha_uz" | "loc_virtual" | "exigir_uz_alocadas", string>>) {
  for (const [chave, valor] of Object.entries(c)) {
    if (valor === undefined) continue;
    await sql`insert into config (chave, valor) values (${chave}, ${valor}) on conflict (chave) do update set valor = excluded.valor`;
  }
}

/** Baixa um arquivo do repositório de planilhas do RPA (privado: usa o token PLANILHAS_GITHUB_TOKEN). */
export async function baixarDoGithub(caminho: string): Promise<Uint8Array> {
  const c = await configWms();
  if (!/^[\w.-]+\/[\w.-]+$/.test(c.repo)) throw new Error("Repositório inválido na configuração.");
  const url = `https://api.github.com/repos/${c.repo}/contents/${caminho.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(c.branch)}`;
  const token = process.env.PLANILHAS_GITHUB_TOKEN;
  const resp = await fetch(url, {
    headers: { Accept: "application/vnd.github.raw", "User-Agent": "tramitacao-nf", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  if (resp.status === 404) throw new Error(`Arquivo "${caminho}" não encontrado em ${c.repo} (${c.branch})${token ? "" : " — o repositório é privado e o token de acesso não está configurado"}.`);
  if (resp.status === 401 || resp.status === 403) throw new Error("O GitHub recusou o acesso. Confira o token PLANILHAS_GITHUB_TOKEN na Vercel.");
  if (!resp.ok) throw new Error(`Falha ao baixar do GitHub (HTTP ${resp.status}).`);
  return new Uint8Array(await resp.arrayBuffer());
}

// ------------------------------------------------------------------ catálogo do estoque

const cabecalho = (linha: unknown[]) => linha.map((c) => String(c ?? "").trim().toUpperCase());

/** Importa o controle-estoque.xlsx: um registro por PI, com descrição e CXP (padrão de caixa). */
export async function importarEstoque(arquivo: Uint8Array, origem: string) {
  let linhas: unknown[][];
  try {
    linhas = (await readSheet(Buffer.from(arquivo))) as unknown[][];
  } catch {
    throw new Error("Não foi possível ler a planilha (.xlsx).");
  }
  const cab = cabecalho(linhas[0] ?? []);
  const iPi = cab.indexOf("PI"), iDesc = cab.indexOf("DESCRICAO"), iCxp = cab.indexOf("CXP");
  if (iPi < 0 || iDesc < 0 || iCxp < 0) throw new Error("A planilha precisa ter as colunas PI, DESCRICAO e CXP na primeira linha.");
  const itens = new Map<string, ItemEstoque>();
  for (const l of linhas.slice(1)) {
    const pi = String(l[iPi] ?? "").trim().toUpperCase();
    if (!pi || itens.has(pi)) continue;
    const cxp = Number(String(l[iCxp] ?? "").replace(",", "."));
    itens.set(pi, { pi, descricao: String(l[iDesc] ?? "").replace(/\s+/g, " ").trim(), cxp: Number.isFinite(cxp) && cxp > 0 ? Math.round(cxp) : null });
  }
  if (itens.size < 10) throw new Error("A planilha parece vazia ou incompleta; o catálogo atual foi mantido.");
  const lista = [...itens.values()];
  await sql.begin(async (tx) => {
    await tx`delete from estoque_itens`;
    for (let i = 0; i < lista.length; i += 1000) await tx`insert into estoque_itens ${tx(lista.slice(i, i + 1000), "pi", "descricao", "cxp")}`;
    await tx`insert into config (chave, valor) values ('estoque_sincronizado', ${JSON.stringify({ em: new Date().toISOString(), origem, linhas: linhas.length - 1, itens: lista.length, semCxp: lista.filter((x) => !x.cxp).length })})
             on conflict (chave) do update set valor = excluded.valor`;
  });
  return { linhas: linhas.length - 1, itens: lista.length };
}

export async function situacaoEstoque() {
  const [r] = await sql`select valor from config where chave = 'estoque_sincronizado'`;
  return r ? (JSON.parse(r.valor) as { em: string; origem: string; linhas: number; itens: number; semCxp: number }) : null;
}

/** Busca no catálogo (para a correção manual). */
export async function buscarNoEstoque(q: string) {
  const termo = q.trim();
  if (!termo) return [];
  const partes = termo.toUpperCase().split(/\s+/).slice(0, 6);
  const cond = partes.map((p) => sql`(e.pi = ${p} or unaccent(upper(e.descricao)) like ${"%" + p.normalize("NFD").replace(/[̀-ͯ]/g, "") + "%"})`).reduce((a, b) => sql`${a} and ${b}`);
  return sql<ItemEstoque[]>`select pi, descricao, cxp from estoque_itens e where ${cond} order by descricao limit 30`;
}

const catalogo = cache(async () => indexar(await sql<ItemEstoque[]>`select pi, descricao, cxp from estoque_itens`));

// ------------------------------------------------------------------ correlação dos itens da NF

export type LinhaCorrelacao = {
  n: number; codigo: string; descricao: string; infAd?: string; qtd: number; un: string;
  confianca: Confianca; item: ItemEstoque | null; candidatos: (ItemEstoque & { pontos: number })[];
  caixas: { cheias: number; fracionada: number; total: number } | null;
};

export async function correlacionarNota(nota: { emit_cnpj: string; itens: ItemNF[] | null }) {
  const itens = nota.itens ?? [];
  const idx = await catalogo();
  if (!itens.length || !idx.porPi.size) return { linhas: [] as LinhaCorrelacao[], catalogoVazio: !idx.porPi.size };
  const chaves = [...new Set(itens.flatMap((i) => chavesAprendizado(i)))];
  const aprendidos = new Map(
    (await sql`select chave, pi from mapa_itens where emit_cnpj = ${nota.emit_cnpj} and chave in ${sql(chaves)}`).map((r) => [r.chave as string, r.pi as string]),
  );
  const linhas = itens.map((i) => {
    const aprendido = chavesAprendizado(i).map((k) => aprendidos.get(k)).find(Boolean);
    const r = correlacionar(idx, i, aprendido);
    return {
      n: i.n, codigo: i.codigo, descricao: i.descricao, infAd: i.infAd, qtd: i.qtd, un: i.un,
      confianca: r.confianca, item: r.item, candidatos: r.candidatos, caixas: caixas(i.qtd, r.item?.cxp),
    };
  });
  return { linhas, catalogoVazio: false };
}

/** Grava a correlação escolhida pelo usuário: vale para esta e para as próximas NF do mesmo fornecedor. */
export async function confirmarCorrelacao(u: Usuario, nota: { emit_cnpj: string; itens: ItemNF[] | null }, n: number, pi: string) {
  const item = (nota.itens ?? []).find((i) => i.n === n);
  if (!item) throw new Error("Item não encontrado na NF.");
  const [e] = await sql`select pi from estoque_itens where pi = ${pi.trim().toUpperCase()}`;
  if (!e) throw new Error(`O PI ${pi} não existe no catálogo do estoque.`);
  for (const chave of chavesAprendizado(item))
    await sql`insert into mapa_itens (emit_cnpj, chave, pi, por) values (${nota.emit_cnpj}, ${chave}, ${e.pi}, ${u.nome})
              on conflict (emit_cnpj, chave) do update set pi = excluded.pi, por = excluded.por, em = now()`;
}

export async function desfazerCorrelacao(nota: { emit_cnpj: string; itens: ItemNF[] | null }, n: number) {
  const item = (nota.itens ?? []).find((i) => i.n === n);
  if (!item) return;
  await sql`delete from mapa_itens where emit_cnpj = ${nota.emit_cnpj} and chave in ${sql(chavesAprendizado(item))}`;
}

// ------------------------------------------------------------------ alocação das UZ (paletes) no WMS

export type SituacaoUz = { estado: "sem_planilha" | "sem_id_pa" | "sem_dados" | "ok" | "pendente"; total: number; pendentes: { uz: string; loc: string }[]; atualizadoEm: Date | null };

export async function situacaoUz(idPa: string | null): Promise<SituacaoUz> {
  const c = await configWms();
  if (!c.planilhaUz) return { estado: "sem_planilha", total: 0, pendentes: [], atualizadoEm: null };
  if (!idPa?.trim()) return { estado: "sem_id_pa", total: 0, pendentes: [], atualizadoEm: null };
  const uz = await sql<{ uz: string; loc: string; atualizado_em: Date }[]>`select uz, loc, atualizado_em from wms_uz where id_pa = ${idPa.trim()} order by uz`;
  if (!uz.length) return { estado: "sem_dados", total: 0, pendentes: [], atualizadoEm: null };
  const pendentes = uz.filter((x) => !x.loc.trim() || x.loc.trim().toUpperCase() === c.locVirtual).map((x) => ({ uz: x.uz, loc: x.loc }));
  return { estado: pendentes.length ? "pendente" : "ok", total: uz.length, pendentes, atualizadoEm: uz[0].atualizado_em };
}

/** Regra da armazenagem: com a exigência ligada, só armazena com todas as UZ do ID de PA fora da LOC virtual (REC). */
export async function bloqueioArmazenagem(nota: { numero: string; id_pa: string | null }): Promise<string | null> {
  const c = await configWms();
  if (!c.exigirUz) return null;
  const s = await situacaoUz(nota.id_pa);
  if (s.estado === "ok") return null;
  if (s.estado === "sem_id_pa") return `NF ${nota.numero}: informe o ID de PA da NF para conferir a alocação das UZ no WMS.`;
  if (s.estado === "pendente") return `NF ${nota.numero}: ${s.pendentes.length} de ${s.total} UZ ainda em ${c.locVirtual} (${s.pendentes.slice(0, 5).map((p) => p.uz).join(", ")}${s.pendentes.length > 5 ? "…" : ""}). Aloque todas antes de armazenar.`;
  return `NF ${nota.numero}: o ID de PA ${nota.id_pa} não aparece na planilha de alocação do WMS. Aguarde a próxima atualização.`;
}

/**
 * Importa a planilha de alocação das UZ (ainda não disponível). Colunas reconhecidas na 1ª linha:
 * ID de PA (ID_PA, IDPA, PA), UZ (UZ, PALETE) e localização (LOC, ENDERECO, LOCALIZACAO).
 */
export async function importarUz(arquivo: Uint8Array, nome: string) {
  let linhas: unknown[][];
  if (/\.csv$/i.test(nome)) {
    const texto = new TextDecoder("utf-8").decode(arquivo);
    const sep = (texto.split("\n")[0].match(/;/g)?.length ?? 0) >= (texto.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
    linhas = texto.split(/\r?\n/).filter(Boolean).map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, "").trim()));
  } else linhas = (await readSheet(Buffer.from(arquivo))) as unknown[][];
  const cab = cabecalho(linhas[0] ?? []);
  const acha = (...nomes: string[]) => cab.findIndex((c) => nomes.includes(c.replace(/[^A-Z]/g, "")));
  const iPa = acha("IDPA", "IDDEPA", "PA"), iUz = acha("UZ", "PALETE", "PALLET"), iLoc = acha("LOC", "LOCAL", "ENDERECO", "LOCALIZACAO");
  if (iPa < 0 || iUz < 0 || iLoc < 0) throw new Error("A planilha de UZ precisa das colunas ID de PA, UZ e LOC (ou ENDERECO).");
  const dados = new Map<string, { id_pa: string; uz: string; loc: string }>();
  for (const l of linhas.slice(1)) {
    const id_pa = String(l[iPa] ?? "").trim(), uz = String(l[iUz] ?? "").trim();
    if (id_pa && uz) dados.set(`${id_pa}|${uz}`, { id_pa, uz, loc: String(l[iLoc] ?? "").trim().toUpperCase() });
  }
  const lista = [...dados.values()];
  await sql.begin(async (tx) => {
    await tx`delete from wms_uz`;
    for (let i = 0; i < lista.length; i += 1000) await tx`insert into wms_uz ${tx(lista.slice(i, i + 1000), "id_pa", "uz", "loc")}`;
    await tx`insert into config (chave, valor) values ('uz_sincronizado', ${JSON.stringify({ em: new Date().toISOString(), registros: lista.length })})
             on conflict (chave) do update set valor = excluded.valor`;
  });
  return { registros: lista.length };
}

/** Atualiza tudo a partir do GitHub (chamado pelo agendamento diário e pelo botão na administração). */
export async function sincronizarDoGithub() {
  const c = await configWms();
  const estoque = await importarEstoque(await baixarDoGithub(c.planilhaEstoque), `GitHub: ${c.repo}/${c.planilhaEstoque}`);
  let uz: { registros: number } | null = null;
  if (c.planilhaUz) uz = await importarUz(await baixarDoGithub(c.planilhaUz), c.planilhaUz);
  return { estoque, uz };
}
