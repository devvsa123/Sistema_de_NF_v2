import "server-only";
import { createHash } from "node:crypto";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString, StandardFonts, type PDFFont, type PDFObject } from "pdf-lib";

/**
 * Assinatura digital de um campo existente do PDF (PAdES / adbe.pkcs7.detached), feita em duas etapas:
 *  1. prepararCampo: acrescenta ao final do PDF (atualização incremental, sem tocar no que já foi assinado)
 *     a assinatura vazia no campo escolhido, com a aparência visível, e calcula o resumo SHA-256 a assinar;
 *  2. encaixarAssinatura: coloca a assinatura CMS devolvida pelo Assinador SERPRO no espaço reservado.
 */

const ESPACO = 24576; // bytes reservados para a assinatura (CMS com a cadeia de certificados)

export type CampoAssinatura = { nome: string; rotulo: string; assinado: boolean };

function texto(o: PDFObject | undefined): string {
  if (o instanceof PDFString || o instanceof PDFHexString) return o.decodeText();
  return "";
}

/** Campos de assinatura do PDF e se já estão assinados. */
export async function camposDeAssinatura(pdf: Uint8Array): Promise<CampoAssinatura[]> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const acro = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  const campos = acro?.lookupMaybe(PDFName.of("Fields"), PDFArray);
  const saida: CampoAssinatura[] = [];
  for (let i = 0; i < (campos?.size() ?? 0); i++) {
    const d = campos!.lookup(i, PDFDict);
    if (d.get(PDFName.of("FT"))?.toString() !== "/Sig") continue;
    saida.push({ nome: texto(d.get(PDFName.of("T"))), rotulo: texto(d.get(PDFName.of("TU"))) || texto(d.get(PDFName.of("T"))), assinado: !!d.get(PDFName.of("V")) });
  }
  return saida;
}

/** Texto em UTF-16BE para strings de PDF (aceita acentos). */
const hexUtf16 = (s: string) => "<FEFF" + Buffer.from(s, "utf16le").swap16().toString("hex").toUpperCase() + ">";

/** Texto em WinAnsi para o conteúdo da aparência (Helvetica). */
function literalWinAnsi(s: string) {
  let out = "";
  for (const c of s) {
    const code = c.codePointAt(0)!;
    const ch = code < 256 ? c : "?";
    out += ch === "(" || ch === ")" || ch === "\\" ? "\\" + ch : ch;
  }
  return "(" + out + ")";
}

function dataPdf(d: Date) {
  const sp = new Date(d.getTime() - 3 * 3600 * 1000); // horário de Brasília (UTC-3)
  const p = (n: number) => String(n).padStart(2, "0");
  return `D:${sp.getUTCFullYear()}${p(sp.getUTCMonth() + 1)}${p(sp.getUTCDate())}${p(sp.getUTCHours())}${p(sp.getUTCMinutes())}${p(sp.getUTCSeconds())}-03'00'`;
}

function dataBR(d: Date) {
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(",", "") + "-0300";
}

export type Selo = { nome: string; cpf?: string | null };
const cpfFormatado = (c: string) => c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");

let metricas: Promise<{ normal: PDFFont; negrito: PDFFont }> | null = null;
function fontes() {
  metricas ??= PDFDocument.create().then(async (d) => ({ normal: await d.embedFont(StandardFonts.Helvetica), negrito: await d.embedFont(StandardFonts.HelveticaBold) }));
  return metricas;
}

/** Conteúdo da aparência visível (selo) para um campo de w × h pontos. */
async function aparencia(selo: Selo, w: number, h: number, quando: Date) {
  const { negrito } = await fontes();
  const quem = selo.nome;
  let tamNome = 8.5;
  while (tamNome > 5.5 && negrito.widthOfTextAtSize(quem.toUpperCase().replace(/[^\x20-\xff]/g, "?"), tamNome) > w - 12) tamNome -= 0.25;
  const linhas = [
    { f: "F1", t: 6.3, s: "Documento assinado digitalmente", cor: "0.35 0.35 0.35" },
    { f: "F2", t: tamNome, s: quem.toUpperCase(), cor: "0 0 0" },
    ...(selo.cpf ? [{ f: "F1", t: 6.3, s: `CPF: ${cpfFormatado(selo.cpf)}`, cor: "0 0 0" }] : []),
    { f: "F1", t: 6.3, s: `Data: ${dataBR(quando)}`, cor: "0 0 0" },
    { f: "F1", t: 6.3, s: "Verifique em https://validar.iti.gov.br", cor: "0.35 0.35 0.35" },
  ];
  const alturaTexto = linhas.reduce((t, l) => t + l.t + 2.2, 0);
  let y = h - Math.max(2, (h - alturaTexto) / 2) - linhas[0].t;
  let c = `q 0.12 0.22 0.39 rg 0 ${(y - alturaTexto + linhas[0].t + 4).toFixed(2)} 2 ${(alturaTexto + 1).toFixed(2)} re f Q\nBT\n`;
  for (const l of linhas) {
    c += `${l.cor} rg /${l.f} ${l.t} Tf 1 0 0 1 7 ${y.toFixed(2)} Tm ${literalWinAnsi(l.s)} Tj\n`;
    y -= l.t + 2.2;
  }
  c += "ET";
  const conteudo = Buffer.from(c, "latin1");
  const fonte = (base: string) => `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`;
  return Buffer.concat([
    Buffer.from(`<< /Type /XObject /Subtype /Form /BBox [0 0 ${w.toFixed(2)} ${h.toFixed(2)}] /Resources << /Font << /F1 ${fonte("Helvetica")} /F2 ${fonte("Helvetica-Bold")} >> >> /Length ${conteudo.length} >>\nstream\n`, "latin1"),
    conteudo,
    Buffer.from("\nendstream", "latin1"),
  ]);
}

const RESERVA_BR = "/ByteRange [0 0000000000 0000000000 0000000000]";

function dicionarioAssinatura(quem: string, quando: Date) {
  return Buffer.from(`<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached ${RESERVA_BR} /Contents <${"0".repeat(ESPACO * 2)}> /M (${dataPdf(quando)}) /Name ${hexUtf16(quem)} /Reason ${hexUtf16("Assinatura pelo Sistema de Tramitação de NF")} >>`, "latin1");
}

type Objeto = { n: number; corpo: Buffer };

/**
 * Acrescenta os objetos ao final do PDF (atualização incremental), com a tabela de referências no mesmo formato
 * do arquivo (tabela clássica ou "xref stream", usada pelo Word e por outros programas), e calcula o ByteRange e o resumo.
 */
function montar(fonte: Buffer, doc: PDFDocument, objs: Objeto[], nSig: number, proximo: number) {
  const fim = fonte.toString("latin1", Math.max(0, fonte.length - 1024));
  const sx = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(fim);
  if (!sx) throw new Error("PDF sem tabela de referências no final; não é possível assinar este arquivo.");
  const prev = Number(sx[1]);
  const usaStream = !fonte.toString("latin1", prev, prev + 4).startsWith("xref");
  const trailer = doc.context.trailerInfo;

  const partes: Buffer[] = [fonte];
  let pos = fonte.length;
  if (fonte[fonte.length - 1] !== 0x0a) { partes.push(Buffer.from("\n")); pos += 1; }
  const offsets = new Map<number, number>();
  for (const o of objs) {
    const cab = Buffer.from(`${o.n} 0 obj\n`, "latin1");
    const pe = Buffer.from("\nendobj\n", "latin1");
    offsets.set(o.n, pos);
    partes.push(cab, o.corpo, pe);
    pos += cab.length + o.corpo.length + pe.length;
  }
  const chaves = [`/Root ${trailer.Root!.toString()}`, `/Prev ${prev}`];
  if (trailer.Info) chaves.push(`/Info ${trailer.Info.toString()}`);
  if (trailer.ID) chaves.push(`/ID ${trailer.ID.toString()}`);
  const inicioXref = pos;
  if (usaStream) {
    const nX = proximo; // a própria tabela também é um objeto
    offsets.set(nX, inicioXref);
    const nums = [...offsets.keys()].sort((a, b) => a - b);
    const dados = Buffer.alloc(nums.length * 7);
    nums.forEach((n, k) => { dados.writeUInt8(1, k * 7); dados.writeUInt32BE(offsets.get(n)!, k * 7 + 1); dados.writeUInt16BE(0, k * 7 + 5); });
    const dic = `<< /Type /XRef /Size ${nX + 1} /W [1 4 2] /Index [${nums.map((n) => `${n} 1`).join(" ")}] ${chaves.join(" ")} /Length ${dados.length} >>`;
    partes.push(Buffer.from(`${nX} 0 obj\n${dic}\nstream\n`, "latin1"), dados, Buffer.from(`\nendstream\nendobj\nstartxref\n${inicioXref}\n%%EOF\n`, "latin1"));
  } else {
    let xref = "xref\n";
    for (const n of [...offsets.keys()].sort((a, b) => a - b)) xref += `${n} 1\n${String(offsets.get(n)).padStart(10, "0")} 00000 n\r\n`;
    xref += `trailer\n<< /Size ${proximo} ${chaves.join(" ")} >>\nstartxref\n${inicioXref}\n%%EOF\n`;
    partes.push(Buffer.from(xref, "latin1"));
  }
  const saida = Buffer.concat(partes);
  const sigInicio = offsets.get(nSig)!;
  const trecho = saida.toString("latin1", sigInicio, sigInicio + 400);
  const iBR = sigInicio + trecho.indexOf(RESERVA_BR);
  const iC = sigInicio + trecho.indexOf("/Contents <") + "/Contents ".length;
  const fimC = iC + 2 + ESPACO * 2;
  const br = [0, iC, fimC, saida.length - fimC];
  const brTexto = `/ByteRange [0 ${String(br[1]).padEnd(10)} ${String(br[2]).padEnd(10)} ${String(br[3]).padEnd(10)}]`;
  if (brTexto.length !== RESERVA_BR.length) throw new Error("PDF grande demais para assinar.");
  saida.write(brTexto, iBR, "latin1");
  const resumo = createHash("sha256").update(saida.subarray(0, iC)).update(saida.subarray(fimC)).digest("base64");
  return { pdf: new Uint8Array(saida), resumo, posicao: iC };
}

/** Regrava o AcroForm (ou o catálogo) com o campo novo na lista e SigFlags 3. */
function atualizarFormulario(doc: PDFDocument, objs: Objeto[], novoCampo: PDFRef | null) {
  const catalogo = doc.catalog;
  const refAcro = catalogo.get(PDFName.of("AcroForm"));
  let acro = catalogo.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  const criar = !acro;
  if (!acro) acro = doc.context.obj({}) as PDFDict;
  if (novoCampo) {
    const refFields = acro.get(PDFName.of("Fields"));
    const fields = acro.lookupMaybe(PDFName.of("Fields"), PDFArray) ?? doc.context.obj([]) as PDFArray;
    fields.push(novoCampo);
    if (refFields instanceof PDFRef) objs.push({ n: refFields.objectNumber, corpo: Buffer.from(fields.toString(), "latin1") });
    else acro.set(PDFName.of("Fields"), fields);
  }
  acro.set(PDFName.of("SigFlags"), doc.context.obj(3));
  if (refAcro instanceof PDFRef) objs.push({ n: refAcro.objectNumber, corpo: Buffer.from(acro.toString(), "latin1") });
  else {
    if (criar) catalogo.set(PDFName.of("AcroForm"), acro);
    const refCat = doc.context.trailerInfo.Root as PDFRef;
    objs.push({ n: refCat.objectNumber, corpo: Buffer.from(catalogo.toString(), "latin1") });
  }
}

/** Prepara o PDF com a assinatura vazia num campo existente e devolve o resumo (base64) que o Assinador vai assinar. */
export async function prepararCampo(pdf: Uint8Array, campo: string, selo: Selo, quando = new Date()) {
  const fonte = Buffer.from(pdf);
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const campos = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict)?.lookupMaybe(PDFName.of("Fields"), PDFArray);
  let ref: PDFRef | undefined;
  let widget: PDFDict | undefined;
  for (let i = 0; i < (campos?.size() ?? 0); i++) {
    const r = campos!.get(i);
    const d = campos!.lookup(i, PDFDict);
    if (texto(d.get(PDFName.of("T"))) === campo && r instanceof PDFRef) { ref = r; widget = d; }
  }
  if (!ref || !widget) throw new Error(`O campo de assinatura “${campo}” não existe neste documento.`);
  if (widget.get(PDFName.of("V"))) throw new Error("Este campo já foi assinado.");
  const [x1, y1, x2, y2] = widget.lookup(PDFName.of("Rect"), PDFArray).asArray().map((n) => Number(n.toString()));
  const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
  const maior = doc.context.largestObjectNumber;
  const nSig = maior + 1, nAp = maior + 2;
  widget.set(PDFName.of("V"), PDFRef.of(nSig));
  widget.set(PDFName.of("AP"), doc.context.obj({ N: PDFRef.of(nAp) }));
  const objs: Objeto[] = [
    { n: nSig, corpo: dicionarioAssinatura(selo.nome, quando) },
    { n: nAp, corpo: await aparencia(selo, w, h, quando) },
    { n: ref.objectNumber, corpo: Buffer.from(widget.toString(), "latin1") },
  ];
  atualizarFormulario(doc, objs, null);
  return montar(fonte, doc, objs, nSig, maior + 3);
}

export const SELO_LARGURA = 200;
export const SELO_ALTURA = 52;

/** Páginas do PDF (tamanho em pontos), para o usuário escolher onde assinar. */
export async function paginasDoPdf(pdf: Uint8Array) {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  return doc.getPages().map((p) => ({ largura: p.getWidth(), altura: p.getHeight() }));
}

/**
 * Prepara a assinatura num campo novo, criado na página e posição escolhidas (documentos sem campo de assinatura,
 * como relatórios e pareceres feitos no Word). x e y são o canto inferior esquerdo do selo, em pontos.
 */
export async function prepararNovoCampo(pdf: Uint8Array, pagina: number, x: number, y: number, rotulo: string, selo: Selo, quando = new Date()) {
  const fonte = Buffer.from(pdf);
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const pag = doc.getPages()[pagina];
  if (!pag) throw new Error("Página inválida.");
  const caixa = pag.getCropBox?.() ?? { x: 0, y: 0, width: pag.getWidth(), height: pag.getHeight() };
  const w = SELO_LARGURA, h = SELO_ALTURA;
  const px = Math.min(Math.max(x, caixa.x), caixa.x + caixa.width - w);
  const py = Math.min(Math.max(y, caixa.y), caixa.y + caixa.height - h);
  const maior = doc.context.largestObjectNumber;
  const nSig = maior + 1, nAp = maior + 2, nCampo = maior + 3;
  const nomeCampo = `Assinatura ${new Date(quando).getTime()}`;
  const widget = doc.context.obj({
    Type: "Annot", Subtype: "Widget", FT: "Sig", F: 4, Rect: [px, py, px + w, py + h], P: pag.ref,
    T: PDFString.of(nomeCampo), TU: PDFHexString.fromText(rotulo), V: PDFRef.of(nSig), AP: { N: PDFRef.of(nAp) },
  });
  const objs: Objeto[] = [
    { n: nSig, corpo: dicionarioAssinatura(selo.nome, quando) },
    { n: nAp, corpo: await aparencia(selo, w, h, quando) },
    { n: nCampo, corpo: Buffer.from(widget.toString(), "latin1") },
  ];
  // a página passa a listar o campo novo entre as anotações
  const refAnnots = pag.node.get(PDFName.of("Annots"));
  const annots = pag.node.lookupMaybe(PDFName.of("Annots"), PDFArray) ?? doc.context.obj([]) as PDFArray;
  annots.push(PDFRef.of(nCampo));
  if (refAnnots instanceof PDFRef) objs.push({ n: refAnnots.objectNumber, corpo: Buffer.from(annots.toString(), "latin1") });
  else {
    pag.node.set(PDFName.of("Annots"), annots);
    objs.push({ n: pag.ref.objectNumber, corpo: Buffer.from(pag.node.toString(), "latin1") });
  }
  atualizarFormulario(doc, objs, PDFRef.of(nCampo));
  return montar(fonte, doc, objs, nSig, maior + 4);
}

/** Coloca a assinatura CMS (base64) no espaço reservado. */
export function encaixarAssinatura(pdf: Uint8Array, posicao: number, assinaturaBase64: string): Uint8Array {
  const der = Buffer.from(assinaturaBase64.replace(/\s+/g, ""), "base64");
  if (!der.length) throw new Error("O Assinador não devolveu a assinatura.");
  if (der.length > ESPACO) throw new Error(`A assinatura (${der.length} bytes) não coube no espaço reservado.`);
  const saida = Buffer.from(pdf);
  if (saida[posicao] !== 0x3c) throw new Error("Documento preparado inválido.");
  saida.write(der.toString("hex").toUpperCase().padEnd(ESPACO * 2, "0"), posicao + 1, "latin1");
  return new Uint8Array(saida);
}
