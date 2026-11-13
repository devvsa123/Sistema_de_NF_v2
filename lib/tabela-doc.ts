import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

/**
 * Insere uma tabela num modelo (.odt ou .docx) no lugar do parágrafo que contém o marcador
 * (por exemplo {{tabela_itens}}). Se o modelo não tiver o marcador, a tabela vai para o fim do documento.
 */

export type Coluna = { titulo: string; cm: number; alinhar?: "dir" | "centro" };
export type Tabela = { titulo: string; colunas: Coluna[]; linhas: string[][]; rodape?: string[]; nota?: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const texto = (xml: string) => xml.replace(/<[^>]+>/g, "");

function substituirParagrafo(xml: string, re: RegExp, marcador: string, bloco: string, fallback: (xml: string) => string) {
  let achou = false;
  const novo = xml.replace(re, (p) => {
    if (achou || !texto(p).includes(marcador)) return p;
    achou = true;
    return bloco;
  });
  return achou ? novo : fallback(xml);
}

// ---------- ODT ----------
function estilosOdt(t: Tabela) {
  const largura = t.colunas.reduce((s, c) => s + c.cm, 0);
  const cel = (nome: string, fundo?: string) =>
    `<style:style style:name="${nome}" style:family="table-cell"><style:table-cell-properties fo:padding="0.05cm" fo:border="0.5pt solid #8c8c8c" style:vertical-align="middle"${fundo ? ` fo:background-color="${fundo}"` : ""}/></style:style>`;
  const par = (nome: string, alinhar: string, extra = "", tam = "7pt") =>
    `<style:style style:name="${nome}" style:family="paragraph"><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0cm" fo:text-align="${alinhar}"/><style:text-properties fo:font-family="Arial" style:font-family-generic="swiss" fo:font-size="${tam}" style:font-size-asian="${tam}" style:font-size-complex="${tam}"${extra}/></style:style>`;
  const negrito = ' fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"';
  return (
    `<style:style style:name="TabItens" style:family="table"><style:table-properties style:width="${largura}cm" table:align="left" fo:margin-top="0cm" fo:margin-bottom="0.1cm"/></style:style>` +
    t.colunas.map((c, i) => `<style:style style:name="TabItensC${i}" style:family="table-column"><style:table-column-properties style:column-width="${c.cm}cm"/></style:style>`).join("") +
    cel("TabItensCel") + cel("TabItensCab", "#e8edf4") + cel("TabItensTot", "#f2f2f2") +
    par("TabItensP", "start") + par("TabItensPD", "end") + par("TabItensPC", "center") +
    par("TabItensPB", "center", negrito) + par("TabItensPBD", "end", negrito) + `<style:style style:name="TabItensTit" style:family="paragraph"><style:paragraph-properties fo:margin-top="0.4cm" fo:margin-bottom="0.15cm" fo:padding-bottom="0.05cm" fo:border-bottom="1.1pt solid #1f3864" fo:border-top="none" fo:border-left="none" fo:border-right="none" fo:keep-with-next="always"/><style:text-properties fo:font-family="Arial" style:font-family-generic="swiss" fo:font-size="9.5pt" fo:color="#1f3864" fo:letter-spacing="0.02cm"${negrito}/></style:style>` + par("TabItensNota", "start", ' fo:font-style="italic" fo:color="#595959"', "7.5pt")
  );
}

function tabelaOdt(t: Tabela) {
  const p = (estilo: string, v: string) => `<text:p text:style-name="${estilo}">${esc(v)}</text:p>`;
  const estiloCol = (c: Coluna, negrito = false) => (negrito ? (c.alinhar === "dir" ? "TabItensPBD" : "TabItensPB") : c.alinhar === "dir" ? "TabItensPD" : c.alinhar === "centro" ? "TabItensPC" : "TabItensP");
  const linha = (vals: string[], cel: string, negrito = false) =>
    `<table:table-row>${vals.map((v, i) => `<table:table-cell table:style-name="${cel}" office:value-type="string">${p(estiloCol(t.colunas[i], negrito), v)}</table:table-cell>`).join("")}</table:table-row>`;
  return (
    p("TabItensTit", t.titulo) +
    `<table:table table:name="TabelaItens" table:style-name="TabItens">` +
    t.colunas.map((_, i) => `<table:table-column table:style-name="TabItensC${i}"/>`).join("") +
    `<table:table-header-rows>${linha(t.colunas.map((c) => c.titulo), "TabItensCab", true)}</table:table-header-rows>` +
    t.linhas.map((l) => linha(l, "TabItensCel")).join("") +
    (t.rodape ? linha(t.rodape, "TabItensTot", true) : "") +
    `</table:table>` +
    (t.nota ? p("TabItensNota", t.nota) : "")
  );
}

function inserirOdt(arquivos: Record<string, Uint8Array>, marcador: string, t: Tabela) {
  let xml = strFromU8(arquivos["content.xml"]);
  xml = xml.includes("<office:automatic-styles/>")
    ? xml.replace("<office:automatic-styles/>", `<office:automatic-styles>${estilosOdt(t)}</office:automatic-styles>`)
    : xml.includes("</office:automatic-styles>")
      ? xml.replace("</office:automatic-styles>", `${estilosOdt(t)}</office:automatic-styles>`)
      : xml.replace("<office:body>", `<office:automatic-styles>${estilosOdt(t)}</office:automatic-styles><office:body>`);
  xml = substituirParagrafo(xml, /<text:p\b[^>]*?(?<!\/)>[\s\S]*?<\/text:p>/g, marcador, tabelaOdt(t), (x) => x.replace("</office:text>", `${tabelaOdt(t)}</office:text>`));
  arquivos["content.xml"] = strToU8(xml);
}

// ---------- DOCX ----------
const TWIPS = 567; // 1 cm
function tabelaDocx(t: Tabela) {
  const run = (v: string, negrito: boolean, tam = 14, italico = false) =>
    `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${negrito ? "<w:b/>" : ""}${italico ? "<w:i/>" : ""}<w:sz w:val="${tam}"/><w:szCs w:val="${tam}"/></w:rPr><w:t xml:space="preserve">${esc(v)}</w:t></w:r>`;
  const par = (v: string, alinhar: string, negrito: boolean, tam = 14, italico = false) =>
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="${alinhar}"/></w:pPr>${run(v, negrito, tam, italico)}</w:p>`;
  const jc = (c: Coluna, cab: boolean) => (c.alinhar === "dir" ? "right" : c.alinhar === "centro" || cab ? "center" : "left");
  const linha = (vals: string[], tipo: "cab" | "item" | "tot") =>
    `<w:tr>${tipo === "cab" ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${vals
      .map((v, i) => {
        const c = t.colunas[i];
        const fundo = tipo === "cab" ? '<w:shd w:val="clear" w:color="auto" w:fill="E8EDF4"/>' : tipo === "tot" ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : "";
        return `<w:tc><w:tcPr><w:tcW w:w="${Math.round(c.cm * TWIPS)}" w:type="dxa"/>${fundo}</w:tcPr>${par(v, jc(c, tipo === "cab"), tipo !== "item")}</w:tc>`;
      })
      .join("")}</w:tr>`;
  const borda = (lado: string) => `<w:${lado} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`;
  return (
    `<w:p><w:pPr><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="1F3864"/></w:pBdr><w:spacing w:before="220" w:after="80"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:color w:val="1F3864"/><w:sz w:val="19"/></w:rPr><w:t xml:space="preserve">${esc(t.titulo)}</w:t></w:r></w:p>` +
    `<w:tbl><w:tblPr><w:tblW w:w="${Math.round(t.colunas.reduce((s, c) => s + c.cm, 0) * TWIPS)}" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(borda).join("")}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="40" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid>${t.colunas.map((c) => `<w:gridCol w:w="${Math.round(c.cm * TWIPS)}"/>`).join("")}</w:tblGrid>` +
    linha(t.colunas.map((c) => c.titulo), "cab") +
    t.linhas.map((l) => linha(l, "item")).join("") +
    (t.rodape ? linha(t.rodape, "tot") : "") +
    `</w:tbl>` +
    (t.nota ? par(t.nota, "left", false, 14, true) : "<w:p/>")
  );
}

function inserirDocx(arquivos: Record<string, Uint8Array>, marcador: string, t: Tabela) {
  let xml = strFromU8(arquivos["word/document.xml"]);
  xml = substituirParagrafo(xml, /<w:p\b[^>]*?(?<!\/)>[\s\S]*?<\/w:p>/g, marcador, tabelaDocx(t), (x) => {
    const i = x.lastIndexOf("<w:sectPr");
    const j = i >= 0 && i > x.lastIndexOf("</w:p>") ? i : x.lastIndexOf("</w:body>");
    return x.slice(0, j) + tabelaDocx(t) + x.slice(j);
  });
  arquivos["word/document.xml"] = strToU8(xml);
}

export function inserirTabela(modelo: Uint8Array, marcador: string, t: Tabela): Uint8Array {
  const arquivos = unzipSync(modelo);
  if (arquivos["word/document.xml"]) {
    inserirDocx(arquivos, marcador, t);
    return zipSync(arquivos, { level: 6 });
  }
  inserirOdt(arquivos, marcador, t);
  const { mimetype, ...resto } = arquivos;
  return zipSync({ mimetype: [mimetype, { level: 0 }], ...resto }, { level: 6 });
}
