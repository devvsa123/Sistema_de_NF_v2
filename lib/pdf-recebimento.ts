import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFRef } from "pdf-lib";
import type { Tabela } from "./tabela-doc";

/**
 * TAV e Check-list gerados direto em PDF, prontos para assinar.
 * Cada assinatura tem um campo próprio no lugar certo: no Adobe aparece "Clique para assinar".
 */

const A4: [number, number] = [595.28, 841.89];
const M = 42;                       // margem
const L = A4[0] - 2 * M;            // largura útil
const AZUL = rgb(0.122, 0.22, 0.392);
const CINZA = rgb(0.35, 0.35, 0.35);
const BORDA = rgb(0.55, 0.55, 0.55);
const FUNDO = rgb(0.91, 0.93, 0.957);
const CM = L / 18;                  // as larguras das tabelas são dadas em "cm" de uma página de 18 cm úteis

type Valores = Record<string, string>;
type Ctx = { doc: PDFDocument; f: PDFFont; b: PDFFont; pag: PDFPage; y: number; paginas: PDFPage[]; rodape: string; brasao?: Awaited<ReturnType<PDFDocument["embedPng"]>> };

/** Remove o que a fonte padrão do PDF não sabe desenhar (setas, emojis...). */
function limpo(f: PDFFont, s: string) {
  const troca: Record<string, string> = { "→": "->", "↳": "-", "✔": "", "✖": "", "✍": "", "–": "-", "“": '"', "”": '"', "‘": "'", "’": "'" };
  let out = "";
  for (const c of String(s ?? "").replace(/\r/g, "")) {
    const t = troca[c] ?? c;
    try { f.encodeText(t); out += t; } catch { out += "?"; }
  }
  return out;
}

function quebrar(f: PDFFont, s: string, tam: number, largura: number): string[] {
  const linhas: string[] = [];
  for (const par of limpo(f, s).split("\n")) {
    let atual = "";
    for (const palavra of par.split(/\s+/).filter(Boolean)) {
      const tenta = atual ? `${atual} ${palavra}` : palavra;
      if (f.widthOfTextAtSize(tenta, tam) <= largura) { atual = tenta; continue; }
      if (atual) linhas.push(atual);
      atual = palavra;
      while (f.widthOfTextAtSize(atual, tam) > largura && atual.length > 1) { // palavra maior que a coluna
        let k = atual.length;
        while (k > 1 && f.widthOfTextAtSize(atual.slice(0, k), tam) > largura) k--;
        linhas.push(atual.slice(0, k));
        atual = atual.slice(k);
      }
    }
    linhas.push(atual);
  }
  return linhas;
}

function texto(c: Ctx, s: string, x: number, y: number, o: { tam?: number; negrito?: boolean; cor?: ReturnType<typeof rgb>; alinhar?: "esq" | "centro" | "dir"; largura?: number } = {}) {
  const fonte = o.negrito ? c.b : c.f, tam = o.tam ?? 9;
  const t = limpo(fonte, s);
  const w = fonte.widthOfTextAtSize(t, tam);
  const px = o.alinhar === "centro" ? x + ((o.largura ?? 0) - w) / 2 : o.alinhar === "dir" ? x + (o.largura ?? 0) - w : x;
  c.pag.drawText(t, { x: px, y, size: tam, font: fonte, color: o.cor ?? rgb(0, 0, 0) });
}

function novaPagina(c: Ctx) {
  c.pag = c.doc.addPage(A4);
  c.paginas.push(c.pag);
  c.y = A4[1] - M;
}

function garantir(c: Ctx, altura: number) {
  if (c.y - altura < M + 24) novaPagina(c);
}

function cabecalho(c: Ctx, titulo: string, subtitulo: string, setor?: string) {
  if (c.brasao) {
    const h = 46, w = (c.brasao.width / c.brasao.height) * h;
    c.pag.drawImage(c.brasao, { x: (A4[0] - w) / 2, y: c.y - h, width: w, height: h });
    c.y -= h + 12;
  }
  texto(c, "MARINHA DO BRASIL", M, c.y, { tam: 10.5, negrito: true, alinhar: "centro", largura: L }); c.y -= 13;
  texto(c, "DEPÓSITO DE FARDAMENTO DA MARINHA NO RIO DE JANEIRO", M, c.y, { tam: 9, negrito: true, alinhar: "centro", largura: L }); c.y -= 12;
  if (setor) { texto(c, setor, M, c.y, { tam: 8.5, negrito: true, cor: CINZA, alinhar: "centro", largura: L }); c.y -= 12; }
  c.y -= 8;
  texto(c, titulo, M, c.y, { tam: titulo.length > 34 ? 12.5 : 15, negrito: true, cor: AZUL, alinhar: "centro", largura: L }); c.y -= 16;
  texto(c, subtitulo, M, c.y, { tam: 11.5, negrito: true, alinhar: "centro", largura: L }); c.y -= 14;
}

function secao(c: Ctx, titulo: string, espacoMinimo = 60) {
  garantir(c, espacoMinimo);
  c.y -= 12;
  texto(c, titulo.toUpperCase(), M, c.y, { tam: 9, negrito: true, cor: AZUL });
  c.y -= 4;
  c.pag.drawLine({ start: { x: M, y: c.y }, end: { x: M + L, y: c.y }, thickness: 1, color: AZUL });
  c.y -= 6;
}

/** Grade de campos: cada célula com rótulo pequeno e valor. */
function grade(c: Ctx, linhas: { rotulo: string; valor: string; cm: number; negrito?: boolean }[][]) {
  for (const linha of linhas) {
    const alturas = linha.map((x) => quebrar(c.b, x.valor || "—", 9.5, x.cm * CM - 10).length);
    const h = 16 + 11.5 * Math.max(...alturas);
    garantir(c, h);
    let x = M;
    for (const cel of linha) {
      const w = cel.cm * CM;
      c.pag.drawRectangle({ x, y: c.y - h, width: w, height: h, borderColor: BORDA, borderWidth: 0.5 });
      texto(c, cel.rotulo.toUpperCase(), x + 5, c.y - 9, { tam: 6, negrito: true, cor: CINZA });
      quebrar(cel.negrito ? c.b : c.f, cel.valor || "—", 9.5, w - 10).forEach((t, i) =>
        texto(c, t, x + 5, c.y - 20 - i * 11.5, { tam: 9.5, negrito: cel.negrito }));
      x += w;
    }
    c.y -= h;
  }
}

function caixa(c: Ctx, x: number, y: number, marcado: boolean, tam = 11) {
  c.pag.drawRectangle({ x, y: y - 2, width: tam, height: tam, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 0.7 });
  if (marcado) texto(c, "X", x + 2.3, y + 0.3, { tam: 9.5, negrito: true, cor: AZUL });
}

/** Quadro de texto livre (observações) com altura mínima. */
function quadro(c: Ctx, conteudo: string, alturaMin: number) {
  const linhas = quebrar(c.f, conteudo.replace(/_{3,}/g, "").trim(), 9, L - 12);
  const h = Math.max(alturaMin, 12 + linhas.length * 11.5);
  garantir(c, h);
  c.pag.drawRectangle({ x: M, y: c.y - h, width: L, height: h, borderColor: BORDA, borderWidth: 0.5 });
  linhas.forEach((t, i) => texto(c, t, M + 6, c.y - 13 - i * 11.5, { tam: 9 }));
  c.y -= h;
}

/** Tabela com quebra de página (cabeçalho repetido). */
function tabela(c: Ctx, t: Tabela) {
  const ws = t.colunas.map((x) => x.cm * CM * (18 / t.colunas.reduce((s, k) => s + k.cm, 0)));
  const TAM = 7.2;
  const desenhaLinha = (vals: string[], tipo: "cab" | "item" | "tot") => {
    const fonte = tipo === "item" ? c.f : c.b;
    const ls = vals.map((v, i) => quebrar(fonte, v, TAM, ws[i] - 6));
    const h = 6 + 8.6 * Math.max(...ls.map((l) => l.length));
    if (c.y - h < M + 24) { novaPagina(c); if (tipo !== "cab") desenhaLinha(t.colunas.map((k) => k.titulo), "cab"); }
    let x = M;
    vals.forEach((_, i) => {
      if (tipo !== "item") c.pag.drawRectangle({ x, y: c.y - h, width: ws[i], height: h, color: tipo === "cab" ? FUNDO : rgb(0.95, 0.95, 0.95) });
      c.pag.drawRectangle({ x, y: c.y - h, width: ws[i], height: h, borderColor: BORDA, borderWidth: 0.4 });
      const al = t.colunas[i].alinhar === "dir" ? "dir" : t.colunas[i].alinhar === "centro" || tipo === "cab" ? "centro" : "esq";
      ls[i].forEach((linha, k) => texto(c, linha, x + 3, c.y - 8.5 - k * 8.6, { tam: TAM, negrito: tipo !== "item", alinhar: al, largura: ws[i] - 6, cor: tipo === "cab" ? AZUL : undefined }));
      x += ws[i];
    });
    c.y -= h;
  };
  desenhaLinha(t.colunas.map((k) => k.titulo), "cab");
  for (const l of t.linhas) desenhaLinha(l, "item");
  if (t.rodape) desenhaLinha(t.rodape, "tot");
  if (t.nota) {
    const ls = quebrar(c.f, t.nota, 7.5, L);
    garantir(c, 6 + ls.length * 9);
    c.y -= 4;
    ls.forEach((linha) => { c.y -= 9; texto(c, linha, M, c.y, { tam: 7.5, cor: CINZA }); });
  }
}

/** Campo de assinatura (o Adobe mostra "Clique para assinar") com linha, nome e cargo. */
function campoAssinatura(c: Ctx, nomeCampo: string, x: number, w: number, nome: string, cargo: string) {
  const topo = c.y;
  const rect = [x + 8, topo - 52, x + w - 8, topo - 4];
  const widget = c.doc.context.obj({
    Type: "Annot", Subtype: "Widget", FT: "Sig", Rect: rect, F: 4, P: c.pag.ref, T: PDFString.of(nomeCampo), TU: PDFString.of(cargo),
  });
  const ref = c.doc.context.register(widget);
  c.pag.node.addAnnot(ref);
  (c.doc.getForm().acroForm as unknown as { addField: (r: PDFRef) => void }).addField(ref);
  c.pag.drawLine({ start: { x: x + 8, y: topo - 56 }, end: { x: x + w - 8, y: topo - 56 }, thickness: 0.8, color: rgb(0, 0, 0) });
  if (nome) texto(c, nome, x, topo - 68, { tam: 8.5, negrito: true, alinhar: "centro", largura: w });
  texto(c, cargo.toUpperCase(), x, topo - (nome ? 79 : 68), { tam: 6.8, cor: CINZA, alinhar: "centro", largura: w });
}

async function iniciar(titulo: string, assunto: string, chaves: string[], rodape: string): Promise<Ctx> {
  const doc = await PDFDocument.create();
  doc.setTitle(titulo);
  doc.setSubject(assunto);
  doc.setKeywords(chaves);
  doc.setAuthor("Sistema de Tramitação de NF — Depósito de Fardamento da Marinha no Rio de Janeiro");
  doc.setCreator("Sistema de Tramitação de NF");
  doc.setProducer("Sistema de Tramitação de NF");
  const [f, b] = await Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold)]);
  let brasao;
  try { brasao = await doc.embedPng(await readFile(path.join(process.cwd(), "public", "brasao.png"))); } catch { /* sem brasão */ }
  const c: Ctx = { doc, f, b, pag: doc.addPage(A4), y: A4[1] - M, paginas: [], rodape, brasao };
  c.paginas.push(c.pag);
  return c;
}

async function finalizar(c: Ctx) {
  c.paginas.forEach((p, i) => {
    const t = limpo(c.f, `${c.rodape} · Página ${i + 1} de ${c.paginas.length}`);
    p.drawText(t, { x: (A4[0] - c.f.widthOfTextAtSize(t, 7)) / 2, y: 22, size: 7, font: c.f, color: CINZA });
  });
  c.doc.getForm().acroForm.dict.set(PDFName.of("SigFlags"), c.doc.context.obj(0));
  return c.doc.save({ useObjectStreams: false });
}

const sem = (v?: string) => (v ?? "").replace(/_{3,}/g, "").replace(/^\s*\/\s*\/\s*$/, "").trim();

export const PERGUNTAS = [
  "Volumes entregues em conformidade com a nota fiscal?",
  "Itens entregues conferem com a quantidade de itens da nota fiscal?",
  "Itens por volume entregues conferem com a quantidade padrão?",
  "Volumes identificados com código de barras afixados externamente?",
  "Embalagens de acordo com o Manual de Embalagens da Marinha?",
  "Etiquetas das embalagens estão em conformidade com a norma de embalagem?",
  "Item acompanha laudo laboratorial?",
];

/** TAV em PDF. */
export async function pdfTav(v: Valores, itens: Tabela | null, ids: { registro: number; nota: number }) {
  const numero = `${v.numero_tav}/${v.ano}`;
  const c = await iniciar(`TAV nº ${numero} — NF ${v.numero_nf}`, `Termo de Abertura de Volumes nº ${numero} da NF ${v.numero_nf}`,
    ["nf-sistema", "nf-doc:tav", `nf-nota:${ids.nota}`, `nf-registro:${ids.registro}`], `TAV nº ${numero} · NF ${v.numero_nf}`);
  cabecalho(c, "TERMO DE ABERTURA DE VOLUMES", `Nº ${numero}`);

  secao(c, "Identificação");
  grade(c, [
    [{ rotulo: "Fornecedor", valor: v.nome_empresa, cm: 14, negrito: true }, { rotulo: "CNPJ", valor: v.cnpj, cm: 4 }],
    [{ rotulo: "Nota fiscal", valor: v.numero_nf, cm: 7, negrito: true }, { rotulo: "Ordem de compra", valor: v.numero_oc, cm: 3.6 }, { rotulo: "ID do PA", valor: v.id_pa, cm: 3.4 }, { rotulo: "Data do recebimento", valor: v.data_recebimento, cm: 4 }],
    [{ rotulo: "Lote", valor: v.lote, cm: 7 }, { rotulo: "Fabricação", valor: v.fabricacao, cm: 3.6 }, { rotulo: "Volumes", valor: v.volumes, cm: 7.4 }],
  ]);

  secao(c, "Conferência", 200);
  texto(c, "FORMA DE CONFERÊNCIA", M, c.y - 8, { tam: 6.5, negrito: true, cor: CINZA });
  c.y -= 24;
  caixa(c, M, c.y, !!v.x_contagem); texto(c, "Contagem manual", M + 17, c.y, { tam: 9 });
  caixa(c, M + L / 2, c.y, !!v.x_pesagem); texto(c, "Pesagem", M + L / 2 + 17, c.y, { tam: 9 });
  c.y -= 12;
  tabela(c, {
    titulo: "", colunas: [{ titulo: "Nº", cm: 1, alinhar: "centro" }, { titulo: "VERIFICAÇÃO", cm: 13 }, { titulo: "SIM", cm: 2, alinhar: "centro" }, { titulo: "NÃO", cm: 2, alinhar: "centro" }],
    linhas: PERGUNTAS.map((p, i) => [String(i + 1), p, v[`q${i + 1}_sim`] ? "X" : "", v[`q${i + 1}_nao`] ? "X" : ""]),
    nota: "* Caso confirmada discrepância em algum item acima, relatar no campo Observações.",
  });

  secao(c, "Observações");
  quadro(c, sem(v.observacao), 52);

  if (itens?.linhas.length) {
    secao(c, "Relação de itens para contagem", 80);
    tabela(c, itens);
  }

  garantir(c, 120);
  secao(c, "Assinaturas", 110);
  c.y -= 6;
  campoAssinatura(c, "Responsavel pre-recebimento", M, L / 2, v.responsavel ?? "", "Responsável pelo pré-recebimento");
  campoAssinatura(c, "Encarregado Secao Recebimento", M + L / 2, L / 2, "", "Encarregado da Seção de Recebimento");
  c.y -= 90;
  return finalizar(c);
}

/** Check-list de Recebimento em PDF. */
export async function pdfChecklist(v: Valores, ids: { registro: number; nota: number }) {
  const numero = `${v.numero_tav}/${v.ano}`;
  const c = await iniciar(`Check-list de Recebimento — NF ${v.numero_nf}`, `Check-list de Recebimento da NF ${v.numero_nf} (TAV nº ${numero})`,
    ["nf-sistema", "nf-doc:checklist", `nf-nota:${ids.nota}`, `nf-registro:${ids.registro}`], `Check-list · TAV nº ${numero} · NF ${v.numero_nf}`);
  cabecalho(c, "CHECK-LIST DE RECEBIMENTO DE ITENS DE FORNECEDORES", `TAV nº ${numero}`, "SEÇÃO DE RECEBIMENTO");

  secao(c, "Identificação");
  grade(c, [
    [{ rotulo: "Empresa", valor: v.nome_empresa, cm: 14, negrito: true }, { rotulo: "CNPJ", valor: v.cnpj, cm: 4 }],
    [{ rotulo: "Número da nota fiscal", valor: v.numero_nf, cm: 5, negrito: true }, { rotulo: "Ordem de compra", valor: v.numero_oc, cm: 4 }, { rotulo: "TAV", valor: numero, cm: 4.5 }, { rotulo: "Data do recebimento", valor: v.data_recebimento, cm: 4.5 }],
  ]);

  secao(c, "Recebimento", 220);
  const linha = (n: string, s: string) => {
    const ls = quebrar(c.f, s, 9.5, L - 18);
    garantir(c, ls.length * 13 + 4);
    texto(c, n, M, c.y - 11, { tam: 9.5, negrito: true });
    ls.forEach((t, i) => texto(c, t, M + 16, c.y - 11 - i * 13, { tam: 9.5 }));
    c.y -= ls.length * 13 + 5;
  };
  linha("1.", `Pesagem de um volume do item: ${sem(v.peso_kg) || "______"} kg, caixa com ${sem(v.itens_caixa) || "______"} UN.`);
  linha("2.", `Enviar amostra para a Divisão Técnica. Data de envio: ${sem(v.data_envio_amostra) || "____/____/______"}.`);
  texto(c, "OBSERVAÇÃO", M, c.y - 8, { tam: 6.5, negrito: true, cor: CINZA }); c.y -= 11;
  quadro(c, sem(v.obs_recebimento), 44);
  c.y -= 8;
  garantir(c, 100);
  c.y -= 4;
  campoAssinatura(c, "Conferente do Recebimento", M + L / 2, L / 2, "", "Conferente do Recebimento");
  c.y -= 84;

  secao(c, "Contagem", 200);
  linha("3.", "Aguardar resultado da Divisão Técnica.");
  linha("4.", "Discrepâncias na contagem:");
  c.y -= 4;
  caixa(c, M + 16, c.y - 6, !!v.discrepancia_sim); texto(c, "Sim", M + 33, c.y - 6, { tam: 9.5 });
  caixa(c, M + 96, c.y - 6, !!v.discrepancia_nao); texto(c, "Não", M + 113, c.y - 6, { tam: 9.5 });
  c.y -= 20;
  texto(c, "OBSERVAÇÃO", M, c.y - 8, { tam: 6.5, negrito: true, cor: CINZA }); c.y -= 11;
  quadro(c, sem(v.obs_contagem), 84);
  c.y -= 8;
  garantir(c, 100);
  c.y -= 4;
  campoAssinatura(c, "Encarregado da Contagem", M + L / 4, L / 2, "", "Encarregado da Contagem");
  c.y -= 84;
  return finalizar(c);
}
