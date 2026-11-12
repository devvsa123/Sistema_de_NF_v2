import "server-only";
import { XMLParser } from "fast-xml-parser";
import { soDigitos } from "./format";
import { extrairOC } from "./oc";

export type ItemNF = {
  n: number;
  codigo: string;
  descricao: string;
  ncm: string;
  cfop: string;
  un: string;
  qtd: number;
  vUnit: number;
  vTotal: number;
  pedido?: string;
  infAd?: string;
};

export type DadosNF = {
  modelo?: string;
  protocolo?: string;
  autorizadaEm?: string;
  emit: { cnpj: string; nome: string; fantasia?: string; ie?: string; municipio?: string; uf?: string; fone?: string };
  dest: { doc?: string; nome?: string; municipio?: string; uf?: string };
  totais: Record<string, number>;
  transp: { modFrete?: string; transportadora?: string; cnpj?: string; volumes: { qVol?: string; esp?: string; pesoL?: string; pesoB?: string }[] };
  duplicatas: { nDup?: string; dVenc?: string; vDup?: number }[];
  infCpl?: string;
  infAdFisco?: string;
  pedido?: string;
  contrato?: string;
};

export type NFLida = {
  chave: string;
  numero: string;
  serie: string;
  emit_cnpj: string;
  emit_nome: string;
  valor: number;
  data_emissao: string | null;
  natureza: string;
  oc: string;
  empenho: string;
  dados: DadosNF;
  itens: ItemNF[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false, // mantém tudo como texto (preserva zeros à esquerda)
  removeNSPrefix: true,
  trimValues: true,
});

type No = Record<string, unknown>;
const no = (v: unknown): No => (v && typeof v === "object" ? (v as No) : {});
const txt = (v: unknown): string => (v === undefined || v === null || typeof v === "object" ? "" : String(v).trim());
const num = (v: unknown): number => Number(txt(v)) || 0;
const lista = (v: unknown): No[] => (v === undefined || v === null ? [] : Array.isArray(v) ? (v as No[]) : [v as No]);

const FRETE: Record<string, string> = {
  "0": "Por conta do remetente (CIF)",
  "1": "Por conta do destinatário (FOB)",
  "2": "Por conta de terceiros",
  "3": "Transporte próprio do remetente",
  "4": "Transporte próprio do destinatário",
  "9": "Sem transporte",
};

export const TAMANHO_MAX_XML = 2 * 1024 * 1024;

/** Lê o XML de uma NF-e (com ou sem protocolo) e devolve os dados principais. */
export function lerNFe(xml: string): NFLida {
  if (!xml || xml.length > TAMANHO_MAX_XML) throw new Error("Arquivo vazio ou maior que 2 MB.");
  let raiz: No;
  try {
    raiz = no(parser.parse(xml));
  } catch {
    throw new Error("O arquivo não é um XML válido.");
  }
  const proc = no(raiz.nfeProc);
  const nfe = no(proc.NFe ?? raiz.NFe);
  const inf = no(nfe.infNFe);
  if (!inf.ide || !inf.emit) throw new Error("O arquivo não parece ser o XML de uma NF-e (tag infNFe não encontrada).");

  const ide = no(inf.ide);
  const emit = no(inf.emit);
  const endEmit = no(emit.enderEmit);
  const dest = no(inf.dest);
  const endDest = no(dest.enderDest);
  const tot = no(no(inf.total).ICMSTot);
  const transp = no(inf.transp);
  const transporta = no(transp.transporta);
  const cobr = no(inf.cobr);
  const infAdic = no(inf.infAdic);
  const compra = no(inf.compra);
  const prot = no(no(proc.protNFe).infProt);

  let chave = soDigitos(txt(inf["@_Id"]));
  if (chave.length !== 44) chave = soDigitos(txt(prot.chNFe));
  if (chave.length !== 44) throw new Error("Chave de acesso não encontrada no XML.");

  const itens: ItemNF[] = lista(inf.det).map((d, i) => {
    const p = no(d.prod);
    return {
      n: Number(txt(d["@_nItem"])) || i + 1,
      codigo: txt(p.cProd),
      descricao: txt(p.xProd),
      ncm: txt(p.NCM),
      cfop: txt(p.CFOP),
      un: txt(p.uCom),
      qtd: num(p.qCom),
      vUnit: num(p.vUnCom),
      vTotal: num(p.vProd),
      pedido: txt(p.xPed) || undefined,
      infAd: txt(d.infAdProd) || undefined,
    };
  });

  const infCpl = txt(infAdic.infCpl);
  const pedido = txt(compra.xPed) || itens.find((i) => i.pedido)?.pedido || "";
  const empenho = txt(compra.xNEmp) || (infCpl.match(/\b(20\d{2}\s?NE\s?\d{5,6})\b/i)?.[1] ?? "").replace(/\s/g, "");

  const totais: Record<string, number> = {};
  for (const k of ["vProd", "vFrete", "vSeg", "vDesc", "vOutro", "vIPI", "vICMS", "vST", "vNF"]) totais[k] = num(tot[k]);

  const dados: DadosNF = {
    modelo: txt(ide.mod),
    protocolo: txt(prot.nProt) || undefined,
    autorizadaEm: txt(prot.dhRecbto) || undefined,
    emit: {
      cnpj: soDigitos(txt(emit.CNPJ) || txt(emit.CPF)),
      nome: txt(emit.xNome),
      fantasia: txt(emit.xFant) || undefined,
      ie: txt(emit.IE) || undefined,
      municipio: txt(endEmit.xMun) || undefined,
      uf: txt(endEmit.UF) || undefined,
      fone: txt(endEmit.fone) || undefined,
    },
    dest: {
      doc: soDigitos(txt(dest.CNPJ) || txt(dest.CPF)) || undefined,
      nome: txt(dest.xNome) || undefined,
      municipio: txt(endDest.xMun) || undefined,
      uf: txt(endDest.UF) || undefined,
    },
    totais,
    transp: {
      modFrete: FRETE[txt(transp.modFrete)] ?? (txt(transp.modFrete) || undefined),
      transportadora: txt(transporta.xNome) || undefined,
      cnpj: soDigitos(txt(transporta.CNPJ)) || undefined,
      volumes: lista(transp.vol).map((v) => ({ qVol: txt(v.qVol), esp: txt(v.esp), pesoL: txt(v.pesoL), pesoB: txt(v.pesoB) })),
    },
    duplicatas: lista(cobr.dup).map((d) => ({ nDup: txt(d.nDup), dVenc: txt(d.dVenc), vDup: num(d.vDup) })),
    infCpl: infCpl || undefined,
    infAdFisco: txt(infAdic.infAdFisco) || undefined,
    pedido: pedido || undefined,
    contrato: txt(compra.xCont) || undefined,
  };

  const emissao = txt(ide.dhEmi) || txt(ide.dEmi);
  return {
    chave,
    numero: txt(ide.nNF),
    serie: txt(ide.serie),
    emit_cnpj: dados.emit.cnpj,
    emit_nome: dados.emit.nome,
    valor: totais.vNF,
    data_emissao: emissao && !isNaN(Date.parse(emissao)) ? new Date(emissao).toISOString() : null,
    natureza: txt(ide.natOp),
    oc: extrairOC(txt(compra.xPed), ...itens.map((i) => i.pedido), infCpl, ...itens.map((i) => i.infAd), txt(infAdic.infAdFisco)),
    empenho,
    dados,
    itens,
  };
}

/** Texto usado na pesquisa livre (número, chave, empresa, OC, itens...). */
export function textoBusca(n: {
  numero: string; chave?: string | null; emit_nome: string; emit_cnpj: string; oc?: string | null; empenho?: string | null; itens?: ItemNF[] | null;
}) {
  return [n.numero, n.chave, n.emit_nome, n.emit_cnpj, n.oc, n.empenho, ...(n.itens ?? []).flatMap((i) => [i.codigo, i.descricao, i.infAd])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
