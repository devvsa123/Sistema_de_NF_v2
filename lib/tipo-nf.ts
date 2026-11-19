/**
 * NF de material ou de serviço, pelos dados da própria NF-e (CFOP dos itens e natureza da operação).
 * Define o certificado que vai junto com o PDF da NF: Recebimento de Bens (material) ou Prestação de Serviços.
 */

export type TipoNF = "material" | "servico";
export const NOME_TIPO_NF: Record<TipoNF, string> = { material: "Material", servico: "Serviço" };

/** CFOP (3 últimos dígitos) de serviço: industrialização por encomenda e prestação de serviço sujeita ao ISSQN. */
const CFOP_SERVICO: Record<string, string> = {
  "124": "industrialização efetuada para outra empresa",
  "125": "industrialização efetuada para outra empresa (insumos de terceiros)",
  "933": "prestação de serviço sujeita ao ISSQN",
};
/** CFOP que acompanham a industrialização (retorno do material enviado pela Marinha) sem indicar compra. */
const CFOP_NEUTRO = new Set(["902", "903", "925"]);

export function classificarNF(nf: { natureza?: string | null; itens?: { cfop?: string | null }[] | null }): { tipo: TipoNF; motivo: string } {
  const cfops = [...new Set((nf.itens ?? []).map((i) => String(i.cfop ?? "").replace(/\D/g, "")).filter((c) => c.length === 4))];
  const servico = cfops.filter((c) => CFOP_SERVICO[c.slice(1)]);
  const compra = cfops.filter((c) => !CFOP_SERVICO[c.slice(1)] && !CFOP_NEUTRO.has(c.slice(1)));
  if (servico.length && !compra.length)
    return { tipo: "servico", motivo: `pelo CFOP ${servico.join(", ")} (${CFOP_SERVICO[servico[0].slice(1)]})` };
  if (servico.length && compra.length)
    return { tipo: "material", motivo: `NF mista: CFOP de serviço ${servico.join(", ")} e de material ${compra.join(", ")}. Confira o tipo.` };
  if (compra.length) return { tipo: "material", motivo: `pelo CFOP ${compra.join(", ")}` };
  const nat = String(nf.natureza ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/industrializacao (efetuada )?(para|por) (outra empresa|encomenda)|prestacao de servico/.test(nat))
    return { tipo: "servico", motivo: `pela natureza da operação “${nf.natureza}”` };
  return { tipo: "material", motivo: nf.natureza ? `pela natureza da operação “${nf.natureza}”` : "sem CFOP nos dados da NF: confira o tipo" };
}

/** Texto para a tela: "Identificado pelo CFOP 6124 (…)", ou o aviso (NF mista, alterado por…) como está. */
export const descreverMotivo = (m: string | null | undefined) => (!m ? "" : /^pel[oa] /.test(m) ? `Identificado ${m}` : m.charAt(0).toUpperCase() + m.slice(1));
