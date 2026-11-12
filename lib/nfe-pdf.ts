import "server-only";
import { getDocumentProxy } from "unpdf";
import { soDigitos } from "./format";
import type { DadosNF, ItemNF, NFLida } from "./nfe";

/**
 * Lê o PDF da "consulta completa" do Portal da NF-e (nfe.fazenda.gov.br → Consultar NF-e →
 * imprimir/salvar como PDF) e devolve os mesmos dados que seriam lidos do XML.
 *
 * A página impressa é formada por pares "rótulo em cima, valor embaixo": o valor fica na linha
 * seguinte, cerca de 3 pontos à direita do rótulo. A leitura se apoia nessa posição.
 */

type Pedaco = { x: number; s: string };
type LinhaPdf = { pag: number; y: number; itens: Pedaco[] };
type Pos = { linha: number; x: number };

const limpar = (s: string) => s.replace(/\s+/g, " ").trim();
const semAcento = (s: string) => limpar(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "907.830,000" → 907830 */
function numBR(s: string | undefined): number {
  const n = Number(String(s ?? "").replace(/\./g, "").replace(",", "."));
  return isFinite(n) ? n : 0;
}

async function extrairLinhas(bytes: Uint8Array): Promise<LinhaPdf[]> {
  const pdf = await getDocumentProxy(bytes);
  if (pdf.numPages > 60) throw new Error("PDF com páginas demais para ser a consulta de uma NF-e.");
  const linhas: LinhaPdf[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const conteudo = await (await pdf.getPage(p)).getTextContent();
    const daPagina: LinhaPdf[] = [];
    for (const it of conteudo.items as { str?: string; transform?: number[] }[]) {
      const s = limpar(it.str ?? "");
      if (!s || !it.transform) continue;
      const x = it.transform[4], y = it.transform[5];
      let l = daPagina.find((c) => Math.abs(c.y - y) <= 2.5);
      if (!l) daPagina.push((l = { pag: p, y, itens: [] }));
      l.itens.push({ x, s });
    }
    daPagina.sort((a, b) => b.y - a.y);
    for (const l of daPagina) {
      l.itens.sort((a, b) => a.x - b.x);
      const texto = l.itens.map((i) => i.s).join(" ");
      // cabeçalho e rodapé que o navegador acrescenta ao imprimir
      if (/^Portal da Nota Fiscal Eletr/i.test(texto) || /^\d+ (of|de) \d+\b/i.test(texto) || /^https?:\/\//i.test(texto)) continue;
      linhas.push(l);
    }
  }
  return linhas;
}

class Leitor {
  readonly linhas: LinhaPdf[];
  constructor(linhas: LinhaPdf[]) {
    this.linhas = linhas;
  }

  /** Procura um rótulo (que pode estar quebrado em vários pedaços) entre as linhas [de, ate). */
  achar(rotulo: string, de = 0, ate = this.linhas.length): Pos | null {
    const alvo = semAcento(rotulo);
    for (let i = Math.max(0, de); i < Math.min(ate, this.linhas.length); i++) {
      const itens = this.linhas[i].itens;
      for (let k = 0; k < itens.length; k++) {
        let junto = "";
        for (let m = k; m < itens.length && junto.length < alvo.length; m++) {
          junto = semAcento(junto + " " + itens[m].s);
          if (junto === alvo) return { linha: i, x: itens[k].x };
        }
      }
    }
    return null;
  }

  /** Linha de um título de seção (texto único na linha). */
  secao(titulo: string, de = 0): number {
    const alvo = semAcento(titulo);
    for (let i = de; i < this.linhas.length; i++) if (semAcento(this.linhas[i].itens.map((x) => x.s).join(" ")) === alvo) return i;
    return -1;
  }

  /** Valor logo abaixo do rótulo: mesma página, linha seguinte, levemente à direita. */
  abaixo(pos: Pos | null, folgaEsq = 1.2): string {
    if (!pos) return "";
    const rot = this.linhas[pos.linha], prox = this.linhas[pos.linha + 1];
    if (!prox || prox.pag !== rot.pag || rot.y - prox.y > 20) return "";
    const v = prox.itens.find((i) => i.x - pos.x >= folgaEsq && i.x - pos.x <= 7);
    return v?.s ?? "";
  }

  valor(rotulo: string, de = 0, ate?: number, folgaEsq?: number): string {
    return this.abaixo(this.achar(rotulo, de, ate), folgaEsq);
  }
}

function conferirChave(chave: string) {
  if (!/^\d{44}$/.test(chave)) return false;
  let soma = 0, peso = 2;
  for (let i = 42; i >= 0; i--) {
    soma += Number(chave[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const dv = 11 - (soma % 11);
  return (dv >= 10 ? 0 : dv) === Number(chave[43]);
}

/** "Informações adicionais do produto" (descrição completa informada pela empresa), quando a consulta traz esse campo. */
function infAdItem(L: Leitor, ini: number, fim: number): string | undefined {
  const pos = L.achar("Informações Adicionais do Produto", ini, fim) ?? L.achar("Informações Adicionais", ini, fim);
  if (!pos) return undefined;
  const partes: string[] = [];
  for (let i = pos.linha + 1; i < fim && partes.length < 8; i++) {
    const it = L.linhas[i].itens;
    if (it.length !== 1) break;
    if (semAcento(it[0].s) === "descricao") continue;
    if (it[0].x < pos.x - 2) break;
    partes.push(it[0].s);
  }
  return partes.join(" ").trim() || undefined;
}

export const TAMANHO_MAX_PDF = 2 * 1024 * 1024;

export async function lerPdfPortal(bytes: Uint8Array): Promise<NFLida> {
  if (!bytes.length || bytes.length > TAMANHO_MAX_PDF) throw new Error("Arquivo vazio ou maior que 2 MB.");
  let linhas: LinhaPdf[];
  try {
    linhas = await extrairLinhas(bytes);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("PDF com")) throw e;
    throw new Error("Não foi possível abrir o PDF.");
  }
  const L = new Leitor(linhas);
  const naoReconhecido =
    "Este PDF não parece ser a consulta completa do Portal da NF-e. Use o site nfe.fazenda.gov.br (Consultar NF-e), abra a nota e salve a página de impressão como PDF.";

  const chave = soDigitos(L.valor("Chave de Acesso"));
  if (!linhas.length || chave.length !== 44) throw new Error(naoReconhecido);
  if (!conferirChave(chave)) throw new Error("A chave de acesso lida do PDF é inválida. O arquivo pode estar incompleto.");

  const sDados = L.secao("Dados da NF-e");
  const sEmit = L.secao("Dados do Emitente");
  const sDest = L.secao("Dados do Destinatário");
  const sProd = L.secao("Dados dos Produtos e Serviços");
  const sTot = L.secao("Totais", Math.max(sProd, 0));
  const sTransp = L.secao("Dados do Transporte", Math.max(sTot, 0));
  const sCobr = L.secao("Dados de Cobrança", Math.max(sTransp, 0));
  const sPag = L.secao("Formas de Pagamento", Math.max(sTransp, 0));
  const sInfo = L.secao("Informações Adicionais", Math.max(sTransp, 0));
  if (sDados < 0 || sEmit < 0 || sProd < 0 || sTot < 0) throw new Error(naoReconhecido);
  const fim = linhas.length;
  const ate = (...c: number[]) => Math.min(...c.filter((n) => n >= 0), fim);

  // ----- cabeçalho -----
  const numero = L.valor("Número", sDados, sEmit).replace(/^0+(?=\d)/, "");
  const serie = L.valor("Série", sDados, sEmit);
  const emissao = L.valor("Data de Emissão", sDados, sEmit).match(/^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}:\d{2}:\d{2})(?:([+-]\d{2}:\d{2}))?)?/);
  const valorNF = numBR(L.valor("Valor Total da Nota Fiscal", sDados, sEmit));
  const blocoEmit = L.achar("Emitente", sDados, sEmit)?.linha ?? sDados;
  const blocoDest = L.achar("Destinatário", blocoEmit, sEmit)?.linha ?? sEmit;
  const emitCnpj = soDigitos(L.valor("CNPJ", blocoEmit, blocoDest) || L.valor("CPF", blocoEmit, blocoDest));
  const emitNome = L.valor("Nome / Razão Social", blocoEmit, blocoDest);
  const eventos = L.achar("Eventos da NF-e", sDados, sEmit);
  let protocolo = "", autorizadaEm = "";
  if (eventos) {
    const pProt = L.achar("Protocolo", eventos.linha, eventos.linha + 1);
    const pData = L.achar("Data Autorização", eventos.linha, eventos.linha + 1);
    for (let i = eventos.linha + 1; i < sEmit && i < eventos.linha + 8; i++) {
      if (!/^Autoriza[cç][aã]o de Uso/i.test(linhas[i].itens[0]?.s ?? "")) continue;
      protocolo = L.abaixo(pProt && { linha: i - 1, x: pProt.x });
      autorizadaEm = L.abaixo(pData && { linha: i - 1, x: pData.x }).match(/^\d{2}\/\d{2}\/\d{4}/)?.[0] ?? "";
      break;
    }
  }

  // a chave traz CNPJ e número: confere se a leitura do PDF bate com ela
  if (emitCnpj.length === 14 && chave.slice(6, 20) !== emitCnpj) throw new Error("Os dados do PDF não conferem com a chave de acesso (CNPJ do emitente).");
  if (!numero || Number(chave.slice(25, 34)) !== Number(numero)) throw new Error("Os dados do PDF não conferem com a chave de acesso (número da NF).");
  if (!emitNome || !emitCnpj) throw new Error(naoReconhecido);

  // ----- itens -----
  const itens: ItemNF[] = [];
  const inicios: number[] = [];
  for (let i = sProd + 1; i < sTot; i++) {
    const it = linhas[i].itens;
    if (it.length >= 4 && /^\d{1,4}$/.test(it[0].s) && /^[\d.]+,\d+$/.test(it[it.length - 1].s) && /^[\d.]+,\d+$/.test(it[it.length - 3].s)) inicios.push(i);
  }
  inicios.forEach((ini, k) => {
    const fimItem = inicios[k + 1] ?? sTot;
    const it = linhas[ini].itens;
    const pCod = L.achar("Código do Produto", ini, fimItem);
    let descricao = it.slice(1, -3).map((x) => x.s).join(" ");
    const xDesc = it[1].x;
    for (let j = ini + 1; j < (pCod?.linha ?? ini + 1); j++) // descrição que continua na linha de baixo
      descricao += " " + linhas[j].itens.filter((x) => Math.abs(x.x - xDesc) < 40 || x.x > xDesc).map((x) => x.s).join(" ");
    itens.push({
      n: Number(it[0].s),
      codigo: L.abaixo(pCod),
      descricao: limpar(descricao),
      ncm: L.valor("Código NCM", ini, fimItem),
      cfop: L.valor("CFOP", ini, fimItem),
      un: it[it.length - 2].s,
      qtd: numBR(it[it.length - 3].s),
      vUnit: numBR(L.valor("Valor unitário de comercialização", ini, fimItem)),
      vTotal: numBR(it[it.length - 1].s),
      pedido: L.valor("Número do pedido de compra", ini, fimItem) || undefined,
      infAd: infAdItem(L, ini, fimItem),
    });
  });
  if (!itens.length) throw new Error("Não encontrei os produtos no PDF. Confira se a consulta foi impressa completa (todas as abas).");

  // ----- totais -----
  const fimTot = ate(sTransp, sCobr, sInfo);
  const t = (rotulo: string) => numBR(L.valor(rotulo, sTot, fimTot));
  const totais: Record<string, number> = {
    vProd: t("Valor Total dos Produtos"), vFrete: t("Valor do Frete"), vSeg: t("Valor do Seguro"), vDesc: t("Valor Total dos Descontos"),
    vOutro: t("Outras Despesas Acessórias"), vIPI: t("Valor Total do IPI"), vICMS: t("Valor do ICMS"), vST: t("Valor ICMS Substituição"),
    vNF: t("Valor Total da NFe") || valorNF,
  };
  const somaItens = itens.reduce((s, i) => s + i.vTotal, 0);
  if (totais.vProd && Math.abs(somaItens - totais.vProd) > 0.05 * itens.length + 0.05)
    throw new Error("A soma dos produtos lidos não confere com o total da nota. O PDF pode estar incompleto.");

  // ----- transporte, cobrança, informações adicionais -----
  const fimTransp = ate(sCobr, sPag, sInfo);
  const volumes: DadosNF["transp"]["volumes"] = [];
  if (sTransp >= 0) {
    for (let i = sTransp; i < fimTransp; i++) {
      if (!/^Volume \d+$/i.test(linhas[i].itens[0]?.s ?? "")) continue;
      const v = { qVol: L.valor("Quantidade", i, i + 3, -1), esp: L.valor("Espécie", i, i + 3, -1), pesoL: "", pesoB: "" };
      const pl = numBR(L.valor("Peso Líquido", i, i + 6, -1)), pb = numBR(L.valor("Peso Bruto", i, i + 6, -1));
      volumes.push({ ...v, pesoL: pl ? String(pl) : "", pesoB: pb ? String(pb) : "" });
    }
  }
  const duplicatas: DadosNF["duplicatas"] = [];
  const pDup = sCobr >= 0 ? L.achar("Duplicatas", sCobr, ate(sPag, sInfo)) : null;
  if (pDup) {
    for (let i = pDup.linha + 2; i < ate(sPag, sInfo); i++) {
      const it = linhas[i].itens;
      const venc = it.find((x) => /^\d{2}\/\d{2}\/\d{4}$/.test(x.s));
      if (!venc || it.length < 3) break;
      duplicatas.push({ nDup: it[0].s, dVenc: venc.s.split("/").reverse().join("-"), vDup: numBR(it[it.length - 1].s) });
    }
  }
  let infCpl = "";
  const pCpl = sInfo >= 0 ? L.achar("Informações Complementares de Interesse do Contribuinte", sInfo) : null;
  const pDesc = pCpl ? L.achar("Descrição", pCpl.linha + 1, pCpl.linha + 3) : null;
  if (pDesc) {
    const partes: string[] = [];
    for (let i = pDesc.linha + 1; i < fim; i++) {
      const it = linhas[i].itens;
      if (it.length !== 1 || it[0].x - pDesc.x < 1.2 || it[0].x - pDesc.x > 7) break;
      partes.push(it[0].s);
    }
    infCpl = partes.join(" ");
  }

  const pedido = itens.find((i) => i.pedido)?.pedido ?? "";
  const ocNoTexto = infCpl.match(/\bO\.?\s?C\.?\s*(?:n[ºo°.]*)?\s*[:\-]?\s*(\d{5,9})\b/i)?.[1] ?? "";
  const empenho = (infCpl.match(/\b(20\d{2}\s?NE\s?\d{5,6})\b/i)?.[1] ?? "").replace(/\s/g, "");
  const municipio = (s: string) => s.replace(/^\d+\s*-\s*/, "");

  const dados: DadosNF = {
    modelo: L.valor("Modelo", sDados, sEmit),
    protocolo: protocolo || undefined,
    autorizadaEm: autorizadaEm ? autorizadaEm.split("/").reverse().join("-") + "T12:00:00-03:00" : undefined,
    emit: {
      cnpj: emitCnpj, nome: emitNome,
      fantasia: L.valor("Nome Fantasia", sEmit, ate(sDest, sProd)) || undefined,
      ie: L.valor("Inscrição Estadual", sEmit, ate(sDest, sProd)) || undefined,
      municipio: municipio(L.valor("Município", sEmit, ate(sDest, sProd))) || undefined,
      uf: L.valor("UF", sEmit, ate(sDest, sProd)) || undefined,
      fone: L.valor("Telefone", sEmit, ate(sDest, sProd)) || undefined,
    },
    dest: sDest < 0 ? {} : {
      doc: soDigitos(L.valor("CNPJ", sDest, sProd) || L.valor("CPF", sDest, sProd)) || undefined,
      nome: L.valor("Nome / Razão Social", sDest, sProd) || undefined,
      municipio: municipio(L.valor("Município", sDest, sProd)) || undefined,
      uf: L.valor("UF", sDest, sProd) || undefined,
    },
    totais,
    transp: {
      modFrete: sTransp >= 0 ? L.valor("Modalidade do Frete", sTransp, fimTransp, -1).replace(/^\d+\s*-\s*/, "") || undefined : undefined,
      transportadora: sTransp >= 0 ? L.valor("Razão Social / Nome", sTransp, fimTransp) || L.valor("Nome / Razão Social", sTransp, fimTransp) || undefined : undefined,
      volumes,
    },
    duplicatas,
    infCpl: infCpl || undefined,
    pedido: pedido || undefined,
  };

  return {
    chave, numero, serie,
    emit_cnpj: emitCnpj, emit_nome: emitNome,
    valor: totais.vNF,
    data_emissao: emissao ? new Date(`${emissao[3]}-${emissao[2]}-${emissao[1]}T${emissao[4] ?? "12:00:00"}${emissao[5] ?? "-03:00"}`).toISOString() : null,
    natureza: L.valor("Natureza da Operação", sDados, sEmit),
    oc: /^\d{5,9}$/.test(pedido) ? pedido : ocNoTexto,
    empenho,
    dados,
    itens,
  };
}
