import "server-only";
import { soDigitos } from "./format";
import { extrairOC } from "./oc";
import { conferirChave, extrairLinhas, limpar, numBR, semAcento, type LinhaPdf } from "./nfe-pdf";
import type { DadosNF, ItemNF, NFLida } from "./nfe";

/**
 * Lê o PDF da DANFE (gerado a partir da chave de acesso, com texto) e devolve os mesmos dados do XML.
 *
 * A DANFE segue o leiaute padrão: cada quadro tem o rótulo em letra pequena e o valor logo abaixo, dentro da
 * mesma coluna. Os itens são lidos linha a linha (código, descrição, NCM, CST, CFOP, unidade, quantidade,
 * valor unitário e total). A leitura é conferida com a chave de acesso (CNPJ, número e série) e com o total
 * dos produtos; se algo não bater, o PDF é recusado.
 */

export const TAMANHO_MAX_DANFE = 3 * 1024 * 1024;

/** O texto do PDF é de uma DANFE (e não da consulta do Portal)? */
export function textoEhDanfe(linhas: LinhaPdf[]) {
  const t = semAcento(linhas.slice(0, 80).map((l) => l.itens.map((i) => i.s).join(" ")).join(" "));
  return t.includes("danfe") && t.includes("documento auxiliar") && !t.includes("dados da nf-e");
}

type Rotulo = { linha: number; x: number; xFim: number };

class Danfe {
  constructor(readonly linhas: LinhaPdf[]) {}

  /** Rótulo (um ou mais pedaços de texto na mesma linha) e a largura da coluna dele (até o próximo rótulo). */
  rotulo(alternativas: string[], de = 0, ate = this.linhas.length): Rotulo | null {
    const alvos = alternativas.map(semAcento);
    for (let i = Math.max(0, de); i < Math.min(ate, this.linhas.length); i++) {
      const it = this.linhas[i].itens;
      for (let k = 0; k < it.length; k++) {
        let junto = "";
        for (let m = k; m < it.length && m < k + 6; m++) {
          junto = semAcento(`${junto} ${it[m].s}`);
          if (alvos.includes(junto)) return { linha: i, x: it[k].x, xFim: it[m + 1]?.x ?? 1e9 };
        }
      }
    }
    return null;
  }

  /** Valor dentro da coluna do rótulo, nas linhas logo abaixo (mesma página). */
  valor(alternativas: string[], de = 0, ate?: number): string {
    const r = this.rotulo(alternativas, de, ate);
    if (!r) return "";
    const base = this.linhas[r.linha];
    for (let i = r.linha + 1; i < this.linhas.length && i <= r.linha + 3; i++) {
      const l = this.linhas[i];
      if (l.pag !== base.pag || base.y - l.y > 26) break;
      const v = l.itens.filter((p) => p.x >= r.x - 4 && p.x < r.xFim - 1).map((p) => p.s);
      if (v.length) return limpar(v.join(" "));
    }
    return "";
  }

  /** Primeira linha que começa com o título da seção (o canhoto, no topo, também cita "destinatário"). */
  secao(titulo: string, de = 0): number {
    const alvo = semAcento(titulo);
    for (let i = de; i < this.linhas.length; i++) if (semAcento(this.texto(i)).startsWith(alvo)) return i;
    return -1;
  }

  texto(i: number) {
    return this.linhas[i].itens.map((p) => p.s).join(" ");
  }
}

const ITEM = /^(\S+)\s+(.+?)\s+(\d{8})\s+(\S{1,6})\s+(\d{4})\s+(\S{1,6})\s+(-?[\d.]+,\d+)\s+(-?[\d.]+,\d+)\s+(-?[\d.]+,\d+)(?:\s|$)/;

/** `lidas`: linhas já extraídas do mesmo PDF (a extração consome o buffer). */
export async function lerDanfe(bytes: Uint8Array, lidas?: LinhaPdf[]): Promise<NFLida> {
  if (!lidas && (!bytes.length || bytes.length > TAMANHO_MAX_DANFE)) throw new Error("Arquivo vazio ou maior que 3 MB.");
  let linhas: LinhaPdf[];
  try {
    linhas = lidas ?? (await extrairLinhas(new Uint8Array(bytes)));
  } catch {
    throw new Error("Não foi possível abrir o PDF.");
  }
  if (linhas.length < 10)
    throw new Error("Este PDF não tem texto (parece digitalizado). Baixe a DANFE pela chave de acesso ou envie o XML; sem eles, use o cadastro manual com a NF digitalizada.");
  const D = new Danfe(linhas);
  const tudo = linhas.map((_, i) => D.texto(i)).join("\n");

  // ----- chave de acesso: identidade da NF -----
  const chaves = [...tudo.matchAll(/(?<!\d)(\d{4}(?:[ .]?\d{4}){10})(?!\d)/g)].map((m) => soDigitos(m[1])).filter(conferirChave);
  const chave = chaves[0] ?? "";
  if (!chave) throw new Error("Não encontrei uma chave de acesso válida na DANFE. Confira se o PDF está completo, ou envie o XML.");
  if (chave.slice(20, 22) !== "55") throw new Error("A chave de acesso não é de uma NF-e (modelo 55).");
  const emitCnpj = chave.slice(6, 20);
  const serie = String(Number(chave.slice(22, 25)));
  const numero = String(Number(chave.slice(25, 34)));

  // número impresso na DANFE confere com a chave
  const nImpresso = tudo.match(/N[º°o.]*\.?\s*0*([\d.]{1,11})\s/i);
  if (nImpresso && Number(soDigitos(nImpresso[1])) !== Number(numero) && !tudo.includes(numero))
    throw new Error("O número impresso na DANFE não confere com a chave de acesso.");

  // ----- emitente -----
  const canhoto = tudo.replace(/\n/g, " ").match(/RECEBEMOS DE\s+(.+?)\s+OS PRODUTOS/i)?.[1];
  let emitNome = limpar(canhoto ?? "");
  if (!emitNome) {
    const r = D.rotulo(["IDENTIFICAÇÃO DO EMITENTE"]);
    if (r) emitNome = limpar(D.texto(r.linha + 1).replace(/DANFE.*/i, ""));
  }
  if (!emitNome) throw new Error("Não encontrei o nome do emitente na DANFE.");
  const cnpjImpresso = soDigitos(D.valor(["CNPJ / CPF", "CNPJ", "CNPJ/CPF"], 0, Math.max(D.secao("DESTINATÁRIO"), 0) || undefined));
  if (cnpjImpresso.length === 14 && cnpjImpresso !== emitCnpj) throw new Error("O CNPJ do emitente na DANFE não confere com a chave de acesso.");

  const natureza = D.valor(["NATUREZA DA OPERAÇÃO", "NATUREZA DE OPERAÇÃO"]);
  const protocoloTxt = D.valor(["PROTOCOLO DE AUTORIZAÇÃO DE USO", "PROTOCOLO DE AUTORIZAÇÃO"]);
  const protocolo = protocoloTxt.match(/\d{15}/)?.[0];
  const autorizada = protocoloTxt.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}:\d{2}))?/);

  // ----- destinatário -----
  const sDest = D.secao("DESTINATÁRIO");
  const sFat = D.secao("FATURA", Math.max(sDest, 0));
  const sImp = D.secao("CÁLCULO DO IMPOSTO", Math.max(sDest, 0));
  const fimDest = [sFat, sImp].filter((n) => n > sDest).sort((a, b) => a - b)[0];
  const emissao = D.valor(["DATA DA EMISSÃO", "DATA DE EMISSÃO"], Math.max(sDest, 0)).match(/(\d{2})\/(\d{2})\/(\d{4})/);

  // ----- totais -----
  const t = (...r: string[]) => numBR(D.valor(r, Math.max(sImp, 0)));
  const totais: Record<string, number> = {
    vProd: t("V. TOTAL PRODUTOS", "VALOR TOTAL DOS PRODUTOS", "V. TOTAL DOS PRODUTOS"),
    vFrete: t("VALOR DO FRETE"), vSeg: t("VALOR DO SEGURO"), vDesc: t("DESCONTO"), vOutro: t("OUTRAS DESPESAS", "OUTRAS DESPESAS ACESSÓRIAS"),
    vIPI: t("VALOR TOTAL IPI", "VALOR DO IPI", "VALOR TOTAL DO IPI"), vICMS: t("VALOR DO ICMS"), vST: t("VALOR DO ICMS SUBST.", "VALOR DO ICMS SUBSTITUIÇÃO"),
    vNF: t("V. TOTAL DA NOTA", "VALOR TOTAL DA NOTA"),
  };
  if (!totais.vNF) throw new Error("Não encontrei o valor total da nota na DANFE.");

  // ----- transporte -----
  const sTransp = D.secao("TRANSPORTADOR");
  const sProd = D.secao("DADOS DOS PRODUTOS");
  const transp = (...r: string[]) => (sTransp >= 0 ? D.valor(r, sTransp, sProd > sTransp ? sProd : undefined) : "");
  const qVol = transp("QUANTIDADE"), esp = transp("ESPÉCIE");
  const pesoB = numBR(transp("PESO BRUTO")), pesoL = numBR(transp("PESO LÍQUIDO"));

  // ----- itens (podem continuar nas páginas seguintes) -----
  if (sProd < 0) throw new Error("Não encontrei os produtos na DANFE.");
  const itens: ItemNF[] = [];
  let dentro = false, xDesc = 0, xNcm = 1e9, pagina = linhas[sProd].pag;
  const extras: string[][] = [];
  for (let i = sProd; i < linhas.length; i++) {
    const l = linhas[i], txt = D.texto(i), s = semAcento(txt);
    if (l.pag !== pagina) { pagina = l.pag; dentro = false; }
    if (s.includes("descricao do produto") || (s.includes("codigo") && s.includes("ncm"))) {
      dentro = true;
      xNcm = l.itens.find((p) => semAcento(p.s).startsWith("ncm"))?.x ?? xNcm;
      continue;
    }
    if (/dados adicionais|informacoes complementares|calculo do issqn/.test(s)) { dentro = false; continue; }
    if (!dentro) continue;
    const m = txt.match(ITEM);
    if (m) {
      itens.push({
        n: itens.length + 1, codigo: m[1], descricao: limpar(m[2]), ncm: m[3], cfop: m[5], un: m[6],
        qtd: numBR(m[7]), vUnit: numBR(m[8]), vTotal: numBR(m[9]),
      });
      extras.push([]);
      xDesc = l.itens[1]?.x ?? xDesc; // a descrição começa no segundo pedaço da linha do item
    } else if (itens.length && l.itens[0].x >= xDesc - 6) {
      // continuação da descrição / informações adicionais do produto (só a coluna da descrição)
      const pedacos = l.itens.filter((p) => p.x >= xDesc - 6 && p.x < xNcm - 2).map((p) => p.s);
      if (pedacos.length) extras[extras.length - 1].push(pedacos.join(" "));
    }
  }
  itens.forEach((it, k) => {
    const mais = limpar(extras[k].join(" "));
    if (mais) it.infAd = mais;
  });
  if (!itens.length) throw new Error("Não consegui ler os itens desta DANFE. Envie o XML da NF.");
  const somaItens = itens.reduce((s, i) => s + i.vTotal, 0);
  if (totais.vProd && Math.abs(somaItens - totais.vProd) > 0.05 * itens.length + 0.05)
    throw new Error("A soma dos itens lidos da DANFE não confere com o total dos produtos. Envie o XML da NF.");

  // ----- informações complementares -----
  let infCpl = "";
  const rCpl = D.rotulo(["INFORMAÇÕES COMPLEMENTARES"]);
  if (rCpl) {
    const rFisco = D.rotulo(["RESERVADO AO FISCO"], rCpl.linha, rCpl.linha + 1);
    const limite = rFisco?.x ?? 1e9, pag = linhas[rCpl.linha].pag;
    const partes: string[] = [];
    for (let i = rCpl.linha + 1; i < linhas.length && linhas[i].pag === pag; i++) {
      const txt = D.texto(i);
      if (/^impresso em/i.test(txt) || /dados dos produtos/i.test(semAcento(txt))) break;
      const p = linhas[i].itens.filter((x) => x.x < limite - 2).map((x) => x.s).join(" ");
      if (p) partes.push(p);
    }
    infCpl = limpar(partes.join(" "));
  }
  const empenho = (infCpl.match(/\b(20\d{2}\s?NE\s?\d{5,6})\b/i)?.[1] ?? "").replace(/\s/g, "")
    || (infCpl.match(/\bEMPENHOS?\s*(?:N[º°o.]*\s*)?:?\s*([\d][\d/.\-]{3,})/i)?.[1] ?? "").slice(0, 60);

  const dados: DadosNF = {
    modelo: "55",
    protocolo,
    autorizadaEm: autorizada ? `${autorizada[3]}-${autorizada[2]}-${autorizada[1]}T${autorizada[4] ?? "12:00:00"}-03:00` : undefined,
    emit: { cnpj: emitCnpj, nome: emitNome },
    dest: sDest < 0 ? {} : {
      doc: soDigitos(D.valor(["CNPJ / CPF", "CNPJ/CPF", "CNPJ"], sDest, fimDest)) || undefined,
      nome: D.valor(["NOME / RAZÃO SOCIAL", "NOME/RAZÃO SOCIAL", "RAZÃO SOCIAL"], sDest, fimDest) || undefined,
      municipio: D.valor(["MUNICÍPIO"], sDest, fimDest) || undefined,
      uf: D.valor(["UF"], sDest, fimDest) || undefined,
    },
    totais,
    transp: {
      modFrete: transp("FRETE POR CONTA", "FRETE", "MODALIDADE DO FRETE").replace(/^\d+\s*-\s*/, "") || undefined,
      transportadora: transp("NOME / RAZÃO SOCIAL", "RAZÃO SOCIAL") || undefined,
      volumes: qVol || esp || pesoB || pesoL ? [{ qVol, esp, pesoB: pesoB ? String(pesoB) : "", pesoL: pesoL ? String(pesoL) : "" }] : [],
    },
    duplicatas: [],
    infCpl: infCpl || undefined,
  };

  return {
    chave, numero, serie,
    emit_cnpj: emitCnpj, emit_nome: emitNome,
    valor: totais.vNF,
    data_emissao: emissao ? new Date(`${emissao[3]}-${emissao[2]}-${emissao[1]}T12:00:00-03:00`).toISOString() : null,
    natureza,
    oc: extrairOC(infCpl, ...itens.map((i) => i.infAd)),
    empenho,
    dados,
    itens,
  };
}
