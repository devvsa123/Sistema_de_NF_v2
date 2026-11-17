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

/** Prepara o PDF com a assinatura vazia no campo e devolve o resumo (base64) que o Assinador vai assinar. */
export async function prepararCampo(pdf: Uint8Array, campo: string, selo: Selo, quando = new Date()) {
  const quem = selo.nome;
  const fonte = Buffer.from(pdf);
  const fim = fonte.toString("latin1", Math.max(0, fonte.length - 1024));
  const sx = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(fim);
  if (!sx) throw new Error("PDF sem tabela de referências no final; não é possível assinar este arquivo.");
  const prev = Number(sx[1]);

  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const acro = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  const campos = acro?.lookupMaybe(PDFName.of("Fields"), PDFArray);
  let ref: PDFRef | undefined;
  let widget: PDFDict | undefined;
  for (let i = 0; i < (campos?.size() ?? 0); i++) {
    const r = campos!.get(i);
    const d = campos!.lookup(i, PDFDict);
    if (texto(d.get(PDFName.of("T"))) === campo && r instanceof PDFRef) { ref = r; widget = d; }
  }
  if (!ref || !widget) throw new Error(`O campo de assinatura “${campo}” não existe neste documento.`);
  if (widget.get(PDFName.of("V"))) throw new Error("Este campo já foi assinado.");
  const rect = widget.lookup(PDFName.of("Rect"), PDFArray).asArray().map((n) => Number(n.toString()));
  const [x1, y1, x2, y2] = rect;
  const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);

  const trailer = doc.context.trailerInfo;
  const maior = doc.context.largestObjectNumber;
  const nSig = maior + 1, nAp = maior + 2, tamanho = maior + 3;

  // aparência visível da assinatura, no padrão dos selos de assinatura digital (gov.br / Adobe)
  const { normal, negrito } = await fontes();
  const larguraUtil = w - 12;
  let tamNome = 8.5;
  while (tamNome > 5.5 && negrito.widthOfTextAtSize(quem.replace(/[^\x20-\xff]/g, "?"), tamNome) > larguraUtil) tamNome -= 0.25;
  const linhas = [
    { f: "F1", t: 6.3, s: "Documento assinado digitalmente", cor: "0.35 0.35 0.35" },
    { f: "F2", t: tamNome, s: quem.toUpperCase(), cor: "0 0 0" },
    ...(selo.cpf ? [{ f: "F1", t: 6.3, s: `CPF: ${cpfFormatado(selo.cpf)}`, cor: "0 0 0" }] : []),
    { f: "F1", t: 6.3, s: `Data: ${dataBR(quando)}`, cor: "0 0 0" },
    { f: "F1", t: 6.3, s: "Verifique em https://validar.iti.gov.br", cor: "0.35 0.35 0.35" },
  ];
  void normal;
  const alturaTexto = linhas.reduce((t, l) => t + l.t + 2.2, 0);
  let y = h - Math.max(2, (h - alturaTexto) / 2) - linhas[0].t;
  // barra vertical à esquerda, como nos selos de assinatura
  let conteudo = `q 0.12 0.22 0.39 rg 0 ${(y - alturaTexto + linhas[0].t + 4).toFixed(2)} 2 ${(alturaTexto + 1).toFixed(2)} re f Q\nBT\n`;
  for (const l of linhas) {
    conteudo += `${l.cor} rg /${l.f} ${l.t} Tf 1 0 0 1 7 ${y.toFixed(2)} Tm ${literalWinAnsi(l.s)} Tj\n`;
    y -= l.t + 2.2;
  }
  conteudo += "ET";
  const conteudoBytes = Buffer.from(conteudo, "latin1");

  const fonteDict = (base: string) => `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`;
  const objs: { n: number; corpo: Buffer }[] = [];
  const reservaBR = "/ByteRange [0 0000000000 0000000000 0000000000]";
  objs.push({
    n: nSig,
    corpo: Buffer.from(`<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached ${reservaBR} /Contents <${"0".repeat(ESPACO * 2)}> /M (${dataPdf(quando)}) /Name ${hexUtf16(quem)} /Reason ${hexUtf16("Assinatura pelo Sistema de Tramitação de NF")} >>`, "latin1"),
  });
  objs.push({
    n: nAp,
    corpo: Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Form /BBox [0 0 ${w.toFixed(2)} ${h.toFixed(2)}] /Resources << /Font << /F1 ${fonteDict("Helvetica")} /F2 ${fonteDict("Helvetica-Bold")} >> >> /Length ${conteudoBytes.length} >>\nstream\n`, "latin1"),
      conteudoBytes,
      Buffer.from("\nendstream", "latin1"),
    ]),
  });
  // o próprio campo (widget) regravado com o valor (a assinatura) e a aparência
  const entradas: string[] = [];
  for (const [k, v] of widget.entries()) {
    const nome = k.toString();
    if (nome === "/V" || nome === "/AP") continue;
    entradas.push(`${nome} ${v.toString()}`);
  }
  entradas.push(`/V ${nSig} 0 R`, `/AP << /N ${nAp} 0 R >>`);
  objs.push({ n: ref.objectNumber, corpo: Buffer.from(`<< ${entradas.join(" ")} >>`, "latin1") });
  // AcroForm com SigFlags 3 (há assinaturas; o documento só aceita acréscimos)
  const acroRef = doc.catalog.get(PDFName.of("AcroForm"));
  if (acroRef instanceof PDFRef && acro) {
    const e: string[] = [];
    for (const [k, v] of acro.entries()) if (k.toString() !== "/SigFlags") e.push(`${k.toString()} ${v.toString()}`);
    e.push("/SigFlags 3");
    objs.push({ n: acroRef.objectNumber, corpo: Buffer.from(`<< ${e.join(" ")} >>`, "latin1") });
  }

  // monta a atualização incremental
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
  const inicioXref = pos;
  let xref = "xref\n";
  for (const n of [...offsets.keys()].sort((a, b) => a - b)) xref += `${n} 1\n${String(offsets.get(n)).padStart(10, "0")} 00000 n\r\n`;
  const t = [`/Size ${tamanho}`, `/Root ${trailer.Root!.toString()}`, `/Prev ${prev}`];
  if (trailer.Info) t.push(`/Info ${trailer.Info.toString()}`);
  if (trailer.ID) t.push(`/ID ${trailer.ID.toString()}`);
  xref += `trailer\n<< ${t.join(" ")} >>\nstartxref\n${inicioXref}\n%%EOF\n`;
  partes.push(Buffer.from(xref, "latin1"));
  const saida = Buffer.concat(partes);

  // posições do espaço da assinatura e ByteRange
  const sigInicio = offsets.get(nSig)!;
  const trecho = saida.toString("latin1", sigInicio, sigInicio + 400);
  const iBR = sigInicio + trecho.indexOf(reservaBR);
  const iC = sigInicio + trecho.indexOf("/Contents <") + "/Contents ".length; // posição do "<"
  const fimC = iC + 2 + ESPACO * 2; // depois do ">"
  const br = [0, iC, fimC, saida.length - fimC];
  const brTexto = `/ByteRange [0 ${String(br[1]).padEnd(10)} ${String(br[2]).padEnd(10)} ${String(br[3]).padEnd(10)}]`;
  if (brTexto.length !== reservaBR.length) throw new Error("PDF grande demais para assinar.");
  saida.write(brTexto, iBR, "latin1");
  const resumo = createHash("sha256").update(saida.subarray(0, iC)).update(saida.subarray(fimC)).digest("base64");
  return { pdf: new Uint8Array(saida), resumo, posicao: iC };
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
