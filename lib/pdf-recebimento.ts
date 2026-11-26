import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFName, PDFString, StandardFonts, degrees, rgb, type PDFFont, type PDFPage, type PDFRef } from "pdf-lib";
import type { Tabela } from "./tabela-doc";
import { RODAPE_DECISAO } from "./pdf-assinar";

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
    if (c === "\n") { out += c; continue; } // quebras de linha são tratadas por quem quebra o texto
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
  const t = limpo(fonte, s).replace(/\n/g, " ");
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
/**
 * TAV em PDF. `minuta`: versão só para imprimir e conferir no recebimento — sem número, sem campo de assinatura,
 * com a marca MINUTA em todas as páginas; não é registrada nem aceita como documento da NF.
 */
export async function pdfTav(v: Valores, itens: Tabela | null, ids: { registro: number; nota: number }, minuta = false,
  recebidos?: { ref: string; n: number; item: string; esperado: number | null; recebidos: number }[]) {
  const numero = `${v.numero_tav}/${v.ano}`;
  const c = minuta
    ? await iniciar(`Minuta do TAV — NF ${v.numero_nf}`, `Minuta do Termo de Abertura de Volumes da NF ${v.numero_nf} (sem valor, só para conferência)`,
      ["nf-sistema", "nf-doc:tav-minuta", `nf-nota:${ids.nota}`], `MINUTA para conferência, sem valor (não substitui o TAV) · NF ${v.numero_nf}`)
    : await iniciar(`TAV nº ${numero} — NF ${v.numero_nf}`, `Termo de Abertura de Volumes nº ${numero} da NF ${v.numero_nf}`,
      ["nf-sistema", "nf-doc:tav", `nf-nota:${ids.nota}`, `nf-registro:${ids.registro}`], `TAV nº ${numero} · NF ${v.numero_nf}`);
  cabecalho(c, "TERMO DE ABERTURA DE VOLUMES", minuta ? "MINUTA PARA CONFERÊNCIA" : `Nº ${numero}`);

  secao(c, "Identificação");
  grade(c, [
    [{ rotulo: "Fornecedor", valor: v.nome_empresa, cm: 14, negrito: true }, { rotulo: "CNPJ", valor: v.cnpj, cm: 4 }],
    [{ rotulo: "Nota fiscal", valor: v.numero_nf, cm: 7, negrito: true }, { rotulo: "Ordem de compra", valor: v.numero_oc, cm: 3.6 }, { rotulo: "ID do PA", valor: v.id_pa, cm: 3.4 }, { rotulo: "Data do recebimento", valor: v.data_recebimento, cm: 4 }],
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

  if (!minuta && recebidos?.length) {
    // pergunta 1 = Não: volumes de fato recebidos de cada item
    secao(c, "Volumes recebidos (em desacordo com a NF)", 80);
    const tot = recebidos.reduce((a, r) => ({ esp: a.esp + (r.esperado ?? 0), rec: a.rec + r.recebidos }), { esp: 0, rec: 0 });
    tabela(c, {
      titulo: "",
      colunas: [{ titulo: "#", cm: 0.8, alinhar: "centro" }, { titulo: "ITEM", cm: 10.2 }, { titulo: "ESPERADO", cm: 2.2, alinhar: "dir" },
        { titulo: "RECEBIDOS", cm: 2.2, alinhar: "dir" }, { titulo: "DIFERENÇA", cm: 2.6, alinhar: "dir" }],
      linhas: recebidos.map((r) => {
        const dif = r.esperado === null ? null : r.recebidos - r.esperado;
        return [r.ref === "total" ? "—" : String(r.n), r.item, r.esperado === null ? "—" : String(r.esperado), String(r.recebidos),
          dif === null ? "—" : dif === 0 ? "confere" : dif > 0 ? `+${dif} a maior` : `${dif} a menor`];
      }),
      rodape: recebidos.length > 1 ? ["", "TOTAL", String(tot.esp), String(tot.rec), ""] : undefined,
      nota: "Esperado: volumes (caixas) pelo padrão do estoque ou informados na NF. Volumes a menor marcam a NF como PARCIAL.",
    });
  }

  if (itens?.linhas.length) {
    secao(c, "Relação de itens para contagem", 80);
    tabela(c, itens);
  }

  if (minuta) {
    // sem campo de assinatura: só a linha para rubrica na conferência, e a marca MINUTA em todas as páginas
    garantir(c, 34);
    c.y -= 26;
    texto(c, "Conferido por: ________________________________________    Data: ____/____/________", M, c.y, { tam: 9 });
    c.y -= 8;
    for (const pag of c.paginas) {
      const marca = "MINUTA";
      const tam = 110, larg = c.b.widthOfTextAtSize(marca, tam);
      pag.drawText(marca, { x: (A4[0] - larg * Math.cos(Math.PI / 5)) / 2 + 20, y: A4[1] / 2 - 160, size: tam, font: c.b, color: rgb(0.85, 0.2, 0.2), opacity: 0.13, rotate: degrees(36) });
      pag.drawText("MINUTA — SEM VALOR, SÓ PARA CONFERÊNCIA. EMITA O TAV NO SISTEMA DEPOIS DO RECEBIMENTO.", { x: M, y: A4[1] - 26, size: 7.5, font: c.b, color: rgb(0.75, 0.1, 0.1) });
    }
    return finalizar(c);
  }

  garantir(c, 120);
  secao(c, "Assinaturas", 110);
  c.y -= 6;
  // assinado somente pelo Responsável pelo Pré-Recebimento
  campoAssinatura(c, "Responsavel pre-recebimento", M + L / 4, L / 2, v.responsavel ?? "", "Responsável pelo Pré-Recebimento");
  c.y -= 90;
  return finalizar(c);
}

type LinhaContagem = { n: number; pi: string | null; item: string; qtd: number; un: string; peso: string; discrepancia: string; diferenca: string; contada?: string };
const num = (v: number, casas = 0) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas === 0 ? 3 : casas });

/** Check-list da Contagem em PDF: itens com PI, peso dos volumes (sem tara), discrepância e diferença por item. */
export async function pdfChecklist(v: Valores, ids: { registro: number; nota: number }, contagem: LinhaContagem[] = []) {
  const numero = `${v.numero_tav}/${v.ano}`;
  const c = await iniciar(`Check-list da Contagem — NF ${v.numero_nf}`, `Check-list da Contagem da NF ${v.numero_nf} (TAV nº ${numero})`,
    ["nf-sistema", "nf-doc:checklist", `nf-nota:${ids.nota}`, `nf-registro:${ids.registro}`], `Check-list da Contagem · TAV nº ${numero} · NF ${v.numero_nf}`);
  cabecalho(c, "CHECK-LIST DA CONTAGEM", `TAV nº ${numero}`, "SEÇÃO DE RECEBIMENTO");

  secao(c, "Identificação");
  grade(c, [
    [{ rotulo: "Empresa", valor: v.nome_empresa, cm: 14, negrito: true }, { rotulo: "CNPJ", valor: v.cnpj, cm: 4 }],
    [{ rotulo: "Número da nota fiscal", valor: v.numero_nf, cm: 5, negrito: true }, { rotulo: "Ordem de compra", valor: v.numero_oc, cm: 4 }, { rotulo: "TAV", valor: numero, cm: 4.5 }, { rotulo: "Data do recebimento", valor: v.data_recebimento, cm: 4.5 }],
  ]);

  secao(c, "Itens contados", 90);
  const qtdTotal = contagem.reduce((t, l) => t + l.qtd, 0);
  const pesoTotal = contagem.reduce((t, l) => t + (Number(l.peso) || 0), 0);
  const difTotal = contagem.reduce((t, l) => t + (l.discrepancia === "Sim" ? Number(l.diferenca) || 0 : 0), 0);
  const sinal = (d: number) => (d > 0 ? `+${num(d)}` : num(d));
  // contagem manual: quantidade contada no lugar do peso
  const manual = contagem.length > 0 && contagem.every((l) => l.contada !== undefined && l.contada !== "");
  if (manual) {
    const contadaTotal = contagem.reduce((t, l) => t + (Number(l.contada) || 0), 0);
    tabela(c, {
      titulo: "",
      colunas: [
        { titulo: "#", cm: 0.7, alinhar: "centro" }, { titulo: "PI", cm: 1.9, alinhar: "centro" }, { titulo: "ITEM", cm: 7.4 },
        { titulo: "QTD. NF", cm: 2, alinhar: "dir" }, { titulo: "QTD. CONTADA", cm: 2.2, alinhar: "dir" },
        { titulo: "DIFERENÇA", cm: 1.9, alinhar: "dir" }, { titulo: "DISCREP.", cm: 1.9, alinhar: "centro" },
      ],
      linhas: contagem.map((l) => {
        const dif = Number(l.diferenca) || 0;
        return [String(l.n), l.pi ?? "—", l.item, `${num(l.qtd)} ${l.un}`.trim(), num(Number(l.contada) || 0), dif ? sinal(dif) : "—", dif ? "SIM" : "NÃO"];
      }),
      rodape: ["", "", "TOTAL", num(qtdTotal), num(contadaTotal), difTotal ? sinal(difTotal) : "—", ""],
      nota: "Conferência por contagem manual: quantidade contada de cada item. Diferença: quantidade recebida a maior (+) ou a menor (-) que a da NF.",
    });
  } else tabela(c, {
    titulo: "",
    colunas: [
      { titulo: "#", cm: 0.7, alinhar: "centro" }, { titulo: "PI", cm: 1.8, alinhar: "centro" }, { titulo: "ITEM", cm: 6.0 },
      { titulo: "QTD. NF", cm: 1.6, alinhar: "dir" }, { titulo: "PESO LÍQ. (KG)", cm: 1.9, alinhar: "dir" },
      { titulo: "DISCREP.", cm: 1.8, alinhar: "centro" }, { titulo: "DIFERENÇA", cm: 1.6, alinhar: "dir" }, { titulo: "QTD. CONTADA", cm: 1.6, alinhar: "dir" },
    ],
    linhas: contagem.map((l) => {
      const dif = l.discrepancia === "Sim" ? Number(l.diferenca) || 0 : 0;
      return [String(l.n), l.pi ?? "—", l.item, `${num(l.qtd)} ${l.un}`.trim(), num(Number(l.peso) || 0, 3), l.discrepancia === "Sim" ? "SIM" : "NÃO",
        l.discrepancia === "Sim" ? sinal(dif) : "—", num(l.qtd + dif)];
    }),
    rodape: contagem.length ? ["", "", "TOTAL", num(qtdTotal), num(pesoTotal, 3), "", difTotal ? sinal(difTotal) : "—", num(qtdTotal + difTotal)] : undefined,
    nota: contagem.length
      ? "Peso líquido: peso dos volumes descontada a tara da caixa. Diferença: quantidade recebida a maior (+) ou a menor (-) que a da NF."
      : "Esta NF não tem itens cadastrados (sem XML/PDF da NF-e).",
  });

  secao(c, "Observações gerais", 70);
  quadro(c, (v.obs_contagem ?? "").replace(/_{3,}/g, "").trim(), 60);

  garantir(c, 110);
  secao(c, "Assinaturas", 100);
  c.y -= 6;
  // assinado somente pelo Responsável pela Contagem
  campoAssinatura(c, "Responsavel pela Contagem", M + L / 4, L / 2, "", "Responsável pela Contagem");
  c.y -= 90;
  return finalizar(c);
}

// ------------------------------------------------------------------ Certificado de Recebimento de Bens

/** Valores fixos do certificado (padrão do Depósito); podem ser trocados aqui se mudarem. */
export const CERTIFICADO_FIXOS = { codigoOm: "71100/71260", cPatrimonial: "EFO", cContabil: "1.1.5.8.1.02.01", nd: "339030-23" };

/** Campo de assinatura num retângulo qualquer (x, y = canto inferior esquerdo). */
function campoEm(c: Ctx, nomeCampo: string, rotulo: string, x: number, y: number, w: number, h: number) {
  const widget = c.doc.context.obj({ Type: "Annot", Subtype: "Widget", FT: "Sig", Rect: [x, y, x + w, y + h], F: 4, P: c.pag.ref, T: PDFString.of(nomeCampo), TU: PDFString.of(rotulo) });
  const ref = c.doc.context.register(widget);
  c.pag.node.addAnnot(ref);
  (c.doc.getForm().acroForm as unknown as { addField: (r: PDFRef) => void }).addField(ref);
}

/**
 * Página do Certificado de Recebimento de Bens (material), no modelo usado pelo Depósito, com campos de assinatura
 * para o fiel de armazenagem, o perito, o fiel de suprimentos e o gestor de bens patrimoniais.
 */
function paginaCertificado(c: Ctx, v: { numero_nf: string; ano: string }) {
  const x0 = 34, W = A4[0] - 68, meio = x0 + W * 0.42;
  let y = A4[1] - 40;
  const linha = (h: number) => { c.pag.drawRectangle({ x: x0, y: y - h, width: W, height: h, borderColor: rgb(0, 0, 0), borderWidth: 0.6 }); };
  const t = (s: string, x: number, yy: number, tam = 7, neg = false, larg?: number) => {
    if (larg) quebrar(neg ? c.b : c.f, s, tam, larg).forEach((l, i) => texto(c, l, x, yy - i * (tam + 1.6), { tam, negrito: neg }));
    else texto(c, s, x, yy, { tam, negrito: neg });
  };
  const vert = (x: number, topo: number, base: number) => c.pag.drawLine({ start: { x, y: topo }, end: { x, y: base }, thickness: 0.6 });
  const data = `DATA:      /      /${v.ano}`;

  linha(14);
  texto(c, "CERTIFICADO DE RECEBIMENTO DE BENS", x0, y - 10, { tam: 8, negrito: true, alinhar: "centro", largura: W });
  y -= 14;
  linha(14); t(`1) DOCUMENTO DE ORIGEM: ${v.numero_nf}`, x0 + 3, y - 10); y -= 14;

  // blocos com declaração em cima e, embaixo, DATA à esquerda e assinatura à direita
  const bloco = (num: string, declaracao: string, cargo: string, campo: string | null, extra?: string) => {
    const ls = quebrar(c.f, `${num} ${declaracao}`, 7, W - 6);
    const hDecl = 6 + ls.length * 8.6;
    const hAss = 50;
    linha(hDecl + hAss + (extra ? 14 : 0));
    ls.forEach((l, i) => texto(c, l, x0 + 3, y - 9 - i * 8.6, { tam: 7 }));
    const topo = y - hDecl;
    c.pag.drawLine({ start: { x: x0, y: topo }, end: { x: x0 + W, y: topo }, thickness: 0.6 });
    vert(meio, topo, topo - hAss);
    t(data, x0 + 3, topo - 28);
    t(`${cargo}:`, meio + 3, topo - 9);
    if (campo) campoEm(c, campo, cargo, meio + 4, topo - hAss + 2, x0 + W - meio - 8, hAss - 14);
    if (extra) { const yb = topo - hAss; c.pag.drawLine({ start: { x: x0, y: yb }, end: { x: x0 + W, y: yb }, thickness: 0.6 }); t(extra, x0 + 3, yb - 10); }
    y -= hDecl + hAss + (extra ? 14 : 0);
  };
  bloco("2)", "CERTIFICO QUE O BEM A QUE SE REFERE O PRESENTE DOCUMENTO FOI POR MIM RECEBIDO.", "FIEL DE ARMAZENAGEM", "Fiel de Armazenagem");
  bloco("3)", "O MATERIAL A QUE SE REFERE O PRESENTE DOCUMENTO FOI POR MIM PERICIADO, CONFERIDO E APROVADO PARA USO.", "PERITO", "Perito");
  bloco("4)", "CERTIFICO QUE O BEM A QUE SE REFERE O PRESENTE DOCUMENTO JÁ FOI PERICIADO, ASSIM, DECLARO A ACEITAÇÃO, ACHANDO-SE O BEM EM PERFEITAS CONDIÇÕES DE APLICAÇÃO E DEVIDAMENTE JUSTIFICADO CONFORME CAMPO ABAIXO.", "REPRESENTANTE DO SETOR REQUISITANTE", null, "JUSTIFICATIVA: ____________________________________________________________________________________");
  bloco("5)", "DECLARO QUE O MATERIAL A QUE SE REFERE O PRESENTE DOCUMENTO FOI REGISTRADO NO CONTROLE DE ESTOQUE.", "FIEL DE SUPRIMENTOS", "Fiel de Suprimentos");
  bloco("6)", "DECLARO QUE O MATERIAL A QUE SE REFERE O PRESENTE DOCUMENTO FOI REGISTRADO NO CONTROLE DE BENS MÓVEIS OU BENS INTANGÍVEIS.", "FIEL DE MATERIAL", null);

  // 7, 8, 9 numa linha
  linha(14);
  const tc = W / 3;
  t(`7) C. PATRIMONIAL: ${CERTIFICADO_FIXOS.cPatrimonial}`, x0 + 3, y - 10); vert(x0 + tc, y, y - 14);
  t(`8) C. CONTÁBIL: ${CERTIFICADO_FIXOS.cContabil}`, x0 + tc + 3, y - 10); vert(x0 + 2 * tc, y, y - 14);
  t(`9) ND: ${CERTIFICADO_FIXOS.nd}`, x0 + 2 * tc + 3, y - 10);
  y -= 14;
  linha(14); t("10) NÚMERO PATRIMONIAL: ________________________________________", x0 + 3, y - 10); y -= 14;
  bloco("11)", "DECLARO QUE O MATERIAL A QUE SE REFERE O PRESENTE DOCUMENTO JÁ PASSOU POR TODAS AS FASES DO RECEBIMENTO DO MATERIAL (INCISO 2.6.2 DA SGM-303 REV. 7).", "GESTOR DE BENS PATRIMONIAIS", "Gestor de Bens Patrimoniais");

  // 12, 13, 14
  linha(24);
  t(`12) CÓDIGO OM: ${CERTIFICADO_FIXOS.codigoOm}`, x0 + 3, y - 10, 7, true); vert(x0 + tc, y, y - 24);
  t("13) DOC. Nº", x0 + tc + 3, y - 10); vert(x0 + 2 * tc, y, y - 24);
  t("14) LICITAÇÃO", x0 + 2 * tc + 3, y - 10); t("TIPO:                    Nº:", x0 + 2 * tc + 3, y - 20);
  y -= 24;
  for (const [n, ag] of [["15)", "AGENTE FISCAL DA OM APOIADA (OMAp):"], ["16)", "AGENTE FINANCEIRO:"], ["17)", "AGENTE FISCAL OM CENTRALIZADORA / UGE:"]]) {
    linha(30); t(`${n} ${data}`, x0 + 3, y - 12); vert(meio, y, y - 30); t(ag, meio + 3, y - 12); y -= 30;
  }
}

/** Campo do Certificado de Prestação de Serviços (assinado somente pela Estocagem). */
export const CAMPO_SERVICO = "Servidor Responsavel";

/**
 * Página do Certificado de Prestação de Serviços (NF de serviço), no modelo do Depósito:
 * um único campo de assinatura, do servidor responsável (Estocagem / fiel de armazenagem).
 */
function paginaCertificadoServico(c: Ctx, v: { numero_nf: string; ano: string }) {
  const W = 330, x0 = 34;
  let y = A4[1] - 40;
  const caixa = (h: number) => c.pag.drawRectangle({ x: x0, y: y - h, width: W, height: h, borderColor: rgb(0, 0, 0), borderWidth: 0.8 });
  const vert = (x: number, topo: number, base: number) => c.pag.drawLine({ start: { x, y: topo }, end: { x, y: base }, thickness: 0.6 });
  const hor = (yy: number, xa = x0, xb = x0 + W) => c.pag.drawLine({ start: { x: xa, y: yy }, end: { x: xb, y: yy }, thickness: 0.6 });
  const col = x0 + W * 0.3;
  const centro = (s: string, xa: number, xb: number, yy: number, tam = 7.5, neg = false) => texto(c, s, xa, yy, { tam, negrito: neg, alinhar: "centro", largura: xb - xa });

  caixa(14); centro("CERTIFICADO DE PRESTAÇÃO DE SERVIÇOS", x0, x0 + W, y - 10, 8.5, true); y -= 14;
  caixa(13); texto(c, `DOCUMENTO DE ORIGEM Nº ${v.numero_nf}`, x0 + 3, y - 9.5, { tam: 7.5 }); y -= 13;
  const decl = quebrar(c.f, "Certifico que o material a que se refere o presente título de crédito/documento foi por mim recebido, conferido e aceito, achando-se em perfeitas condições de aplicação.", 7, W - 8);
  const hDecl = 5 + decl.length * 9;
  caixa(hDecl); decl.forEach((l, i) => texto(c, l, x0 + 4, y - 9 - i * 9, { tam: 7 })); y -= hDecl;
  // DATA | SERVIDOR RESPONSÁVEL (com o campo de assinatura)
  caixa(18); vert(col, y, y - 18 - 58); centro("DATA", x0, col, y - 12); centro("SERVIDOR RESPONSÁVEL", col, x0 + W, y - 12); y -= 18;
  caixa(58);
  texto(c, `      /      /${v.ano}`, x0 + 8, y - 32, { tam: 7.5 });
  campoEm(c, CAMPO_SERVICO, "Servidor Responsável (Fiel de Armazenagem)", col + 2, y - 56, x0 + W - col - 4, 54);
  y -= 58;
  // CÓD. OM | DOC. Nº | LICITAÇÃO (TIPO / Nº)
  const c1 = x0 + W / 3, c2 = x0 + (2 * W) / 3, c3 = c2 + (x0 + W - c2) / 2;
  caixa(12); vert(c1, y, y - 12 - 30); vert(c2, y, y - 12 - 30);
  centro("CÓD. OM", x0, c1, y - 9); centro("DOC. Nº", c1, c2, y - 9); centro("LICITAÇÃO", c2, x0 + W, y - 9); y -= 12;
  caixa(30); hor(y - 10, c2); vert(c3, y, y - 30); centro("TIPO", c2, c3, y - 8, 7); centro("Nº", c3, x0 + W, y - 8, 7); y -= 30;
  // DATA | AGENTE FINANCEIRO/GESTOR
  caixa(12); vert(col, y, y - 12 - 36); centro("DATA", x0, col, y - 9); centro("AGENTE FINANCEIRO/GESTOR", col, x0 + W, y - 9); y -= 12;
  caixa(36); y -= 36;
  caixa(12); texto(c, "AGENTE FISCAL", x0 + 3, y - 9, { tam: 7.5 }); y -= 12;
  caixa(24);
}

/**
 * NF com o certificado: acrescenta a página do Certificado de Recebimento de Bens (material) ou do
 * Certificado de Prestação de Serviços (serviço) ao PDF da NF.
 * Se o PDF da NF já estiver assinado, devolve null (não se mexe num documento assinado).
 */
export async function nfComCertificado(nf: Uint8Array, v: { numero_nf: string; ano: string }, ids: { nota: number }, tipo: "material" | "servico" = "material") {
  const bruto = Buffer.from(nf).toString("latin1");
  if (/\/ByteRange\s*\[/.test(bruto)) return null;
  const doc = await PDFDocument.load(nf, { ignoreEncryption: true, updateMetadata: false });
  const [f, b] = await Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold)]);
  const pag = doc.addPage(A4);
  const c: Ctx = { doc, f, b, pag, y: A4[1] - M, paginas: [pag], rodape: "" };
  if (tipo === "servico") paginaCertificadoServico(c, v); else paginaCertificado(c, v);
  doc.setKeywords(["nf-sistema", "nf-doc:nf-certificado", `nf-nota:${ids.nota}`, `nf-tipo:${tipo}`]);
  doc.setTitle(`NF ${v.numero_nf} e ${tipo === "servico" ? "Certificado de Prestação de Serviços" : "Certificado de Recebimento de Bens"}`);
  return doc.save({ useObjectStreams: false });
}

// ------------------------------------------------------------------ Parecer da Divisão Técnica

/** Quadro de decisão: fica em branco (com as opções em cinza) até quem decide assinar no sistema. */
/** Quadro de decisão. Com `incluirNome`, o campo cobre também o nome impresso abaixo (substituído quando assina o substituto). */
function quadroDecisao(c: Ctx, campo: string, rotulo: string, opcoes: string[], quem: string[], h = 150, incluirNome = false) {
  garantir(c, h + 40);
  const topo = c.y;
  c.pag.drawRectangle({ x: M, y: topo - h, width: L, height: h, borderColor: BORDA, borderWidth: 0.6 });
  texto(c, opcoes.map((o) => `(   ) ${o}`).join("        "), M + 6, topo - 26, { tam: 8.5, cor: CINZA });
  texto(c, "Preenchido na assinatura pelo sistema (decisão, observações e assinatura digital).", M + 6, topo - 42, { tam: 7, cor: CINZA });
  if (incluirNome) campoEm(c, campo, rotulo, M + 1, topo - h - RODAPE_DECISAO, L - 2, h - 1 + RODAPE_DECISAO);
  else campoEm(c, campo, rotulo, M + 1, topo - h + 1, L - 2, h - 2);
  c.y = topo - h - 12;
  quem.filter(Boolean).forEach((linha, i) => { texto(c, linha, M, c.y, { tam: i === 0 ? 8.5 : 7.5, negrito: i === 0, alinhar: "centro", largura: L, cor: i === 0 ? undefined : CINZA }); c.y -= 11; });
}

/** Parecer da Divisão Técnica em PDF, com campos para o Perito, o Encarregado da Divisão Técnica e o Diretor. */
export async function pdfParecer(v: Valores, ids: { nota: number; laudo: number }) {
  const { CAMPO_PERITO, DECISOES } = await import("./parecer-campos");
  const prot = v.protocolo || String(ids.laudo);
  const c = await iniciar(`Parecer ${prot} — NF ${v.numero_nf}`, `Parecer da Divisão Técnica nº ${prot}, NF ${v.numero_nf}`,
    ["nf-sistema", "nf-doc:parecer", `nf-nota:${ids.nota}`, `nf-laudo:${ids.laudo}`], `Parecer da Divisão Técnica nº ${prot} · NF ${v.numero_nf}`);
  cabecalho(c, "PARECER DA DIVISÃO TÉCNICA", `Nº ${prot}`, "DIVISÃO TÉCNICA");

  secao(c, "Identificação");
  grade(c, [
    [{ rotulo: "Nº do parecer", valor: prot, cm: 4.5, negrito: true }, { rotulo: "Número da NF", valor: v.numero_nf, cm: 4.5, negrito: true }, { rotulo: "Número da OC", valor: v.numero_oc, cm: 4.5 }, { rotulo: "Entrada na perícia", valor: v.data_pericia, cm: 4.5 }],
    [{ rotulo: "Empresa", valor: v.nome_empresa, cm: 10, negrito: true }, { rotulo: "CNPJ", valor: v.cnpj, cm: 4 }, { rotulo: "Valor da NF", valor: v.valor_nf, cm: 4 }],
  ]);

  secao(c, `Análise visual: ${v.resultado_visual}`, 120);
  grade(c, [[{ rotulo: "Foram aferidas todas as medidas comuns e básicas?", valor: v.medidas, cm: 18 }]]);
  texto(c, "OBSERVAÇÕES", M, c.y - 9, { tam: 6.5, negrito: true, cor: CINZA }); c.y -= 12;
  quadro(c, v.obs_visual || "", 40);

  secao(c, `Análise laboratorial: ${v.resultado_laboratorial}`, 110);
  grade(c, [[{ rotulo: "Ofício encaminhado ao SENAI", valor: v.numero_oficio, cm: 6 }, { rotulo: "Enviado para o laboratório em", valor: v.data_envio, cm: 6 }, { rotulo: "Recebido do laboratório em", valor: v.data_recebimento, cm: 6 }]]);
  texto(c, "OBSERVAÇÕES", M, c.y - 9, { tam: 6.5, negrito: true, cor: CINZA }); c.y -= 12;
  quadro(c, v.obs_laboratorial || "", 34);

  garantir(c, 100);
  c.y -= 10;
  campoAssinatura(c, CAMPO_PERITO, M + L / 2, L / 2, v.perito ?? "", "Perito Avaliador");
  c.y -= 88;

  const tec = DECISOES["Encarregado da Divisao Tecnica"], dir = DECISOES["Resolucao do Diretor"];
  secao(c, "Parecer do Encarregado da Divisão Técnica", 210);
  quadroDecisao(c, "Encarregado da Divisao Tecnica", "Encarregado da Divisão Técnica", tec.opcoes, [v.encarregado_nome ?? "", "Encarregado da Divisão Técnica"]);
  secao(c, "Resolução do Sr. Diretor", 210);
  quadroDecisao(c, "Resolucao do Diretor", "Diretor", dir.opcoes, [v.diretor_nome ?? "", v.diretor_posto ?? "", v.diretor_cargo || "Diretor"], 150, true);
  return finalizar(c);
}

// ------------------------------------------------------------------ Histórico da NF (pacote final)

export type HistoricoNF = {
  nota: { id: number; numero: string; serie: string | null; chave: string | null; emit_nome: string; emit_cnpj: string; valor: string; oc: string | null;
    empenho: string | null; natureza: string | null; data_emissao: Date | null; tipo_nf: string; sob_medida: boolean; id_pa: string | null;
    recebida_em: Date; status: string; etapa: string | null; obs_oc: string | null };
  itens: { n: number; codigo: string; descricao: string; qtd: number; un: string; vTotal: number; cfop: string }[];
  eventos: { criado_em: Date; tipo: string; de_nome: string | null; para_nome: string | null; usuario_nome: string | null; texto: string | null }[];
  documentos: { tipo: string; nome: string; enviado_por: string | null; criado_em: Date; sha256: string; tamanho: number; removido: string | null;
    assinaturas: { nome: string; tipo: string; quando: string | null; integra: boolean }[] }[];
  geradoPor: string; geradoEm: Date;
};

const dh = (d: Date | string | null) => (d ? new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", "") : "—");
const brl = (v: number | string) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Histórico completo da NF em PDF: identificação, itens, toda a tramitação e os documentos com as assinaturas. */
export async function pdfHistorico(h: HistoricoNF, tipoEvento: Record<string, string>) {
  const n = h.nota;
  const c = await iniciar(`Histórico da NF ${n.numero}`, `Histórico sistêmico da NF ${n.numero} — ${n.emit_nome}`,
    ["nf-sistema", "nf-doc:historico", `nf-nota:${n.id}`], `Histórico da NF ${n.numero} · gerado em ${dh(h.geradoEm)} por ${h.geradoPor}`);
  cabecalho(c, "HISTÓRICO DA NOTA FISCAL", `NF nº ${n.numero}${n.serie ? ` · série ${n.serie}` : ""}`, "SISTEMA DE TRAMITAÇÃO DE NF");

  secao(c, "Identificação");
  const cnpjF = n.emit_cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  grade(c, [
    [{ rotulo: "Empresa", valor: n.emit_nome, cm: 12, negrito: true }, { rotulo: "CNPJ", valor: cnpjF, cm: 6 }],
    [{ rotulo: "Número da NF", valor: n.numero, cm: 4.5, negrito: true }, { rotulo: "Valor", valor: brl(n.valor), cm: 4.5 }, { rotulo: "OC", valor: n.oc ?? "", cm: 4.5 }, { rotulo: "Empenho", valor: n.empenho ?? "", cm: 4.5 }],
    [{ rotulo: "Chave de acesso", valor: n.chave ?? "", cm: 12 }, { rotulo: "Emissão", valor: n.data_emissao ? dh(n.data_emissao).slice(0, 10) : "", cm: 6 }],
    [{ rotulo: "Natureza da operação", valor: n.natureza ?? "", cm: 9 }, { rotulo: "Tipo", valor: `${n.tipo_nf === "servico" ? "Serviço" : "Material"}${n.sob_medida ? " · sob medida" : ""}`, cm: 4.5 }, { rotulo: "ID de PA", valor: n.id_pa ?? "", cm: 4.5 }],
    [{ rotulo: "Cadastrada no sistema", valor: dh(n.recebida_em), cm: 6 }, { rotulo: "Situação na geração deste histórico", valor: n.etapa ? `Em trâmite: ${n.etapa}` : n.status, cm: 12 }],
  ]);
  if (n.obs_oc) { texto(c, "OBSERVAÇÕES DA OC", M, c.y - 9, { tam: 6.5, negrito: true, cor: CINZA }); c.y -= 12; quadro(c, n.obs_oc, 20); }

  if (h.itens.length) {
    secao(c, `Itens da NF (${h.itens.length})`, 80);
    tabela(c, {
      titulo: "Itens",
      colunas: [{ titulo: "#", cm: 0.8, alinhar: "centro" }, { titulo: "CÓDIGO", cm: 2.6 }, { titulo: "DESCRIÇÃO", cm: 8.6 }, { titulo: "CFOP", cm: 1.2, alinhar: "centro" },
        { titulo: "QTD.", cm: 2.2, alinhar: "dir" }, { titulo: "VALOR", cm: 2.6, alinhar: "dir" }],
      linhas: h.itens.map((i) => [String(i.n), i.codigo, i.descricao, i.cfop, `${i.qtd.toLocaleString("pt-BR")} ${i.un}`, brl(i.vTotal)]),
    } as Tabela);
  }

  secao(c, `Tramitação e histórico (${h.eventos.length} registros)`, 80);
  tabela(c, {
    titulo: "Histórico",
    colunas: [{ titulo: "DATA E HORA", cm: 2.5 }, { titulo: "REGISTRO", cm: 2.6 }, { titulo: "USUÁRIO", cm: 3.2 }, { titulo: "DETALHE", cm: 9.7 }],
    linhas: h.eventos.map((e) => [
      dh(e.criado_em), tipoEvento[e.tipo] ?? e.tipo, e.usuario_nome ?? "Sistema",
      [e.de_nome || e.para_nome ? `${e.de_nome ?? "—"} -> ${e.para_nome ?? "—"}` : "", e.texto ?? ""].filter(Boolean).join(" · ") || "—",
    ]),
  } as Tabela);

  secao(c, `Documentos da NF (${h.documentos.length})`, 80);
  tabela(c, {
    titulo: "Documentos",
    colunas: [{ titulo: "DOCUMENTO", cm: 4.6 }, { titulo: "ENVIADO", cm: 3.2 }, { titulo: "ASSINATURAS DIGITAIS", cm: 6 }, { titulo: "SHA-256 DO ARQUIVO", cm: 4.2 }],
    linhas: h.documentos.map((d) => [
      `${d.tipo}\n${d.nome}${d.removido ? `\n(substituído/removido: ${d.removido})` : ""}`,
      `${dh(d.criado_em)}\n${d.enviado_por ?? ""}`,
      d.assinaturas.length ? d.assinaturas.map((a) => `${a.nome} (${a.tipo}${a.quando ? `, ${dh(a.quando)}` : ""})${a.integra ? "" : " - NÃO CONFERE"}`).join("\n") : "sem assinatura digital",
      d.sha256,
    ]),
    nota: "O SHA-256 identifica cada arquivo: o mesmo arquivo sempre gera o mesmo código. Os arquivos foram baixados no pacote final da NF e excluídos do sistema na finalização; este histórico permanece no sistema.",
  } as Tabela);
  return finalizar(c);
}
