/**
 * Correlação entre os itens da NF e o catálogo do estoque (WMS). Funções puras, sem banco.
 *
 * Ordem: 1) PI escrito na NF; 2) correlação já confirmada para o fornecedor; 3) comparação da descrição.
 * Na comparação, o tipo de peça (primeira palavra do item do estoque) e o tamanho precisam bater.
 */

export type ItemEstoque = { pi: string; descricao: string; cxp: number | null };
export type Confianca = "pi" | "confirmada" | "alta" | "media" | "nenhuma";
export type Candidato = ItemEstoque & { pontos: number };
export type Correlacao = { confianca: Confianca; item: ItemEstoque | null; candidatos: Candidato[] };

const PARADAS = new Set(["DE", "DA", "DO", "DAS", "DOS", "COM", "SEM", "PARA", "E", "A", "O", "EM", "NA", "NO", "COR", "TAM", "TAMANHO", "REF", "MODELO", "UN", "UND", "PC", "PCT"]);
const TAMANHO = /^(\d{1,3}|PP|P|M|G|GG|XG|XGG|EG|EGG|EXG|XXG|G1|G2|G3|G4|U|UNICO)$/;
const RE_PI = /\b(19\d{7}|BR\d{7})\b/g;

export function normalizar(s: string) {
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/\bM\s*\/\s*M\b|MANGA\s+CURTA/g, " MANGACURTA ")
    .replace(/\bM\s*\/\s*L\b|MANGA\s+LONGA/g, " MANGALONGA ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

const tokens = (s: string) => normalizar(s).split(" ").filter((t) => t && !PARADAS.has(t));

/** Tamanho do item do estoque: último termo de tamanho, ignorando o que está entre parênteses. */
export function tamanhoDoEstoque(descricao: string): string | null {
  const t = tokens(descricao.replace(/\([^)]*\)/g, " "));
  const ult = t[t.length - 1];
  return ult && TAMANHO.test(ult) && t.length > 1 ? ult : null;
}

/** Tamanhos citados na NF: fim de cada trecho ("... - M", "(PED) G") ou depois de TAM / Nº. */
export function tamanhosDaNF(texto: string): Set<string> {
  const out = new Set<string>();
  const sem = texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  for (const m of sem.matchAll(/\b(?:TAM(?:ANHO)?|N[º°O]?|NUMERO|NR)\.?\s*[:\-]?\s*([A-Z0-9]{1,3})\b/g)) if (TAMANHO.test(m[1])) out.add(m[1]);
  for (const trecho of sem.split(/\s[-–]\s|[,;|]|\(|\)/)) {
    const t = trecho.replace(/[^A-Z0-9 ]+/g, " ").trim().split(/\s+/);
    const ult = t[t.length - 1];
    if (ult && TAMANHO.test(ult) && t.length >= 1) out.add(ult);
  }
  return out;
}

export function pisNoTexto(...textos: (string | null | undefined)[]) {
  const out: string[] = [];
  for (const t of textos) for (const m of (t ?? "").toUpperCase().matchAll(RE_PI)) out.push(m[1]);
  return out;
}

/** Índice do catálogo, montado uma vez por requisição. */
export function indexar(catalogo: ItemEstoque[]) {
  const porPi = new Map(catalogo.map((c) => [c.pi, c]));
  const doc = catalogo.map((c) => {
    const tam = tamanhoDoEstoque(c.descricao);
    const t = [...new Set(tokens(c.descricao.replace(/\([^)]*\)/g, " ")))].filter((x) => x !== tam);
    return { c, tam, t, tipo: t[0] ?? "" };
  });
  const df = new Map<string, number>();
  for (const d of doc) for (const t of d.t) df.set(t, (df.get(t) ?? 0) + 1);
  const n = catalogo.length || 1;
  const idf = (t: string) => Math.log(1 + n / (df.get(t) ?? 1));
  return { porPi, doc, idf };
}
export type Indice = ReturnType<typeof indexar>;

/** O termo do estoque aparece na NF? Aceita igual, abreviação (FEM → FEMININA) e palavras emendadas (MULTI PROPOSITO). */
function aparece(t: string, nfTokens: Set<string>, nfLista: string[], compacto: string) {
  if (nfTokens.has(t)) return true;
  if (t.length < 3) return false;
  if (nfLista.some((x) => x.startsWith(t))) return true;
  return t.length >= 5 && compacto.includes(t);
}

export function correlacionar(
  idx: Indice,
  item: { codigo?: string | null; descricao: string; infAd?: string | null },
  aprendido?: string | null,
): Correlacao {
  // 1) PI informado pelo fornecedor
  for (const pi of pisNoTexto(item.codigo, item.descricao, item.infAd)) {
    const c = idx.porPi.get(pi);
    if (c) return { confianca: "pi", item: c, candidatos: [] };
  }
  // 2) correlação já confirmada para este fornecedor
  if (aprendido && idx.porPi.get(aprendido)) return { confianca: "confirmada", item: idx.porPi.get(aprendido)!, candidatos: [] };

  // 3) comparação da descrição (nome + descrição completa)
  const texto = `${item.descricao} ${item.infAd ?? ""}`;
  const nfLista = tokens(texto);
  const nfTokens = new Set(nfLista);
  const compacto = nfLista.join("");
  const principais = tokens(item.descricao).filter((t) => !TAMANHO.test(t));
  const tamanhos = tamanhosDaNF(texto);

  const cand: Candidato[] = [];
  for (const d of idx.doc) {
    if (!d.t.length || !aparece(d.tipo, nfTokens, nfLista, compacto)) continue; // tipo de peça precisa bater
    if (d.tam && tamanhos.size && !tamanhos.has(d.tam)) continue; // tamanho diferente: descarta
    let peso = 0, achado = 0;
    for (const t of d.t) {
      const w = idx.idf(t);
      peso += w;
      if (aparece(t, nfTokens, nfLista, compacto)) achado += w;
    }
    const cobertura = peso ? achado / peso : 0;
    // quanto do nome do item da NF o item do estoque explica (desempata "MEIA BRANCA" x "MEIA BRANCA ALGODAO")
    const doEstoque = new Set(d.t);
    const precisao = principais.length ? principais.filter((t) => doEstoque.has(t) || d.t.some((x) => x.length >= 3 && t.startsWith(x))).length / principais.length : 0;
    let pontos = 0.75 * cobertura + 0.25 * precisao;
    if (d.tam && !tamanhos.size) pontos *= 0.7; // NF não informa o tamanho
    if (!d.tam && tamanhos.size) pontos *= 0.85; // NF tem tamanho e o item do estoque não
    if (pontos > 0.35) cand.push({ ...d.c, pontos });
  }
  cand.sort((a, b) => b.pontos - a.pontos || a.pi.localeCompare(b.pi));
  // itens repetidos no estoque (mesma descrição com PI diferente) contam como um só
  const unicos: Candidato[] = [];
  for (const c of cand) if (!unicos.some((u) => normalizar(u.descricao) === normalizar(c.descricao))) unicos.push(c);
  const [melhor, segundo] = unicos;
  if (!melhor) return { confianca: "nenhuma", item: null, candidatos: [] };
  const folga = segundo ? melhor.pontos - segundo.pontos : 1;
  const confianca: Confianca =
    (melhor.pontos >= 0.8 && folga >= 0.05) || (melhor.pontos >= 0.7 && folga >= 0.2) ? "alta" : melhor.pontos >= 0.55 ? "media" : "nenhuma";
  // empate entre itens diferentes (ex.: sapato sem o número): não sugere nenhum, mostra as opções
  const escolhido = confianca === "nenhuma" || (confianca === "media" && folga < 0.02) ? null : melhor;
  return { confianca, item: escolhido, candidatos: unicos.slice(0, 6) };
}

/** Caixas pelo padrão do estoque (CXP): 101 unidades com CXP 20 = 5 cheias + 1 com 1 unidade. */
export function caixas(qtd: number, cxp: number | null | undefined) {
  if (!cxp || cxp <= 0 || !(qtd > 0)) return null;
  const cheias = Math.floor(qtd / cxp);
  const sobra = Math.round((qtd - cheias * cxp) * 1000) / 1000;
  return { cheias, fracionada: sobra > 0 ? sobra : 0, total: cheias + (sobra > 0 ? 1 : 0) };
}

/** Chaves usadas para lembrar a correlação confirmada de um fornecedor. */
export function chavesAprendizado(item: { codigo?: string | null; descricao: string; infAd?: string | null }) {
  const out: string[] = [];
  if (item.codigo?.trim()) out.push("cod:" + item.codigo.trim().toUpperCase());
  out.push("desc:" + normalizar(`${item.descricao} ${item.infAd ?? ""}`).slice(0, 300));
  return out;
}
