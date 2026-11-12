import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

/**
 * Preenche marcadores em um modelo do Word (.docx).
 * O Word costuma quebrar um marcador como {{numero_nf}} em vários pedaços de texto (runs);
 * aqui o texto de cada parágrafo é remontado, o marcador é trocado e a formatação do trecho onde ele começa é mantida.
 */

const ENT: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
const desescapar = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENT[m]);
const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Marcadores no formato {{nome}} (e, por compatibilidade, os antigos @#nome). */
export const RE_MARCADOR = /\{\{\s*([a-z0-9_]+)\s*\}\}|@#([A-Za-zÀ-ÿ0-9_]+)/g;

type Pedaco = { ini: number; fim: number; abre: string; texto: string };

function substituirNoXml(xml: string, valor: (nome: string) => string | undefined, achados?: Set<string>): string {
  const re = /(<w:t(?:\s[^>]*)?>)([^<]*)<\/w:t>|<w:p[\s>]|<\/w:p>/g;
  const grupos: Pedaco[][] = [[]];
  for (let m; (m = re.exec(xml)); ) {
    if (m[1] === undefined) grupos.push([]);
    else grupos[grupos.length - 1].push({ ini: m.index, fim: m.index + m[0].length, abre: m[1], texto: desescapar(m[2]) });
  }
  const trocas: { ini: number; fim: number; novo: string }[] = [];
  for (const g of grupos) {
    if (!g.length) continue;
    const completo = g.map((p) => p.texto).join("");
    if (!completo.includes("{{") && !completo.includes("@#")) continue;
    // posição de início de cada pedaço no texto completo
    const inicio: number[] = [];
    g.reduce((acc, p, i) => ((inicio[i] = acc), acc + p.texto.length), 0);
    const novos = g.map((p) => p.texto.split(""));
    let mudou = false;
    for (const m of completo.matchAll(RE_MARCADOR)) {
      const nome = (m[1] ?? m[2]).toLowerCase();
      achados?.add(m[1] ? m[1] : "@#" + m[2]);
      const v = valor(m[1] ? nome : "@#" + nome);
      if (v === undefined) continue;
      mudou = true;
      const a = m.index!, b = a + m[0].length;
      g.forEach((_, i) => {
        for (let k = 0; k < novos[i].length; k++) {
          const pos = inicio[i] + k;
          if (pos >= a && pos < b) novos[i][k] = pos === a ? v : "";
        }
      });
    }
    if (!mudou) continue;
    g.forEach((p, i) => {
      const texto = novos[i].join("");
      if (texto === p.texto) return;
      const abre = p.abre.includes("xml:space") ? p.abre : p.abre.replace("<w:t", '<w:t xml:space="preserve"');
      // quebras de linha no valor viram <w:br/>
      const corpo = texto.split("\n").map(escapar).join(`</w:t><w:br/>${abre}`);
      trocas.push({ ini: p.ini, fim: p.fim, novo: `${abre}${corpo}</w:t>` });
    });
  }
  let saida = "";
  let pos = 0;
  for (const t of trocas.sort((x, y) => x.ini - y.ini)) {
    saida += xml.slice(pos, t.ini) + t.novo;
    pos = t.fim;
  }
  return saida + xml.slice(pos);
}

const PARTES = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

function abrir(modelo: Uint8Array) {
  let arquivos: Record<string, Uint8Array>;
  try {
    arquivos = unzipSync(modelo);
  } catch {
    throw new Error("O arquivo não é um documento do Word (.docx) válido.");
  }
  if (!arquivos["word/document.xml"]) throw new Error("O arquivo não é um documento do Word (.docx) válido.");
  return arquivos;
}

/** Gera o documento preenchido. Marcadores sem valor conhecido saem em branco. */
export function preencherDocx(modelo: Uint8Array, valores: Record<string, string>): Uint8Array {
  const arquivos = abrir(modelo);
  const busca = (nome: string) => valores[nome] ?? "";
  for (const nome of Object.keys(arquivos)) {
    if (PARTES.test(nome)) arquivos[nome] = strToU8(substituirNoXml(strFromU8(arquivos[nome]), busca));
  }
  return zipSync(arquivos, { level: 6 });
}

/** Lista os marcadores encontrados no modelo (para conferência ao trocar o modelo). */
export function marcadoresDoModelo(modelo: Uint8Array): string[] {
  const arquivos = abrir(modelo);
  const achados = new Set<string>();
  for (const nome of Object.keys(arquivos)) {
    if (PARTES.test(nome)) substituirNoXml(strFromU8(arquivos[nome]), () => undefined, achados);
  }
  return [...achados].sort();
}

/** Troca trechos de texto literais (usado só para preparar o modelo padrão). */
export function trocarTextos(modelo: Uint8Array, pares: [string, string][]): Uint8Array {
  const arquivos = abrir(modelo);
  for (const nome of Object.keys(arquivos)) {
    if (!PARTES.test(nome)) continue;
    let xml = strFromU8(arquivos[nome]);
    for (const [de, para] of pares) {
      // insere um marcador temporário para reaproveitar a lógica que lida com runs quebrados
      const re = /(<w:t(?:\s[^>]*)?>)([^<]*)<\/w:t>|<w:p[\s>]|<\/w:p>/g;
      const grupos: Pedaco[][] = [[]];
      for (let m; (m = re.exec(xml)); ) {
        if (m[1] === undefined) grupos.push([]);
        else grupos[grupos.length - 1].push({ ini: m.index, fim: m.index + m[0].length, abre: m[1], texto: desescapar(m[2]) });
      }
      const trocas: { ini: number; fim: number; novo: string }[] = [];
      for (const g of grupos) {
        const completo = g.map((p) => p.texto).join("");
        const a = completo.indexOf(de);
        if (a < 0) continue;
        const b = a + de.length;
        let acc = 0;
        g.forEach((p) => {
          const ini = acc, fim = acc + p.texto.length;
          acc = fim;
          if (fim <= a || ini >= b) return;
          const chars = p.texto.split("").map((c, k) => (ini + k >= a && ini + k < b ? (ini + k === a ? para : "") : c));
          if (ini > a && ini < b && !chars.join("")) { trocas.push({ ini: p.ini, fim: p.fim, novo: `${p.abre}</w:t>` }); return; }
          const abre = p.abre.includes("xml:space") ? p.abre : p.abre.replace("<w:t", '<w:t xml:space="preserve"');
          trocas.push({ ini: p.ini, fim: p.fim, novo: `${abre}${escapar(chars.join(""))}</w:t>` });
        });
      }
      let saida = "", pos = 0;
      for (const t of trocas.sort((x, y) => x.ini - y.ini)) { saida += xml.slice(pos, t.ini) + t.novo; pos = t.fim; }
      xml = saida + xml.slice(pos);
    }
    arquivos[nome] = strToU8(xml);
  }
  return zipSync(arquivos, { level: 6 });
}
