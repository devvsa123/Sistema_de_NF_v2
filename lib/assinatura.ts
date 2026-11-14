import { createHash, webcrypto } from "node:crypto";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

/**
 * Leitura e conferência das assinaturas digitais de um PDF (PAdES / adbe.pkcs7.detached / ETSI.CAdES.detached).
 * Confere a integridade (o conteúdo assinado não foi alterado e a assinatura bate com o certificado)
 * e identifica quem assinou, quando e o tipo de certificado (gov.br ou ICP-Brasil).
 */

pkijs.setEngine("nodeEngine", new pkijs.CryptoEngine({ name: "nodeEngine", crypto: webcrypto as unknown as Crypto }));

export type Assinatura = {
  nome: string;            // nome do titular
  cpf: string | null;      // quando o certificado traz (ICP-Brasil: "NOME:CPF")
  email: string | null;
  emissor: string;         // AC que emitiu o certificado
  tipo: "gov.br" | "ICP-Brasil" | "outro";
  quando: string | null;   // ISO
  integra: boolean;        // assinatura confere com o conteúdo assinado
  cobreTudo: boolean;      // a assinatura cobre o documento inteiro (nada foi acrescentado depois)
  erro?: string;
};

const OID = { cn: "2.5.4.3", ou: "2.5.4.11", o: "2.5.4.10", email: "1.2.840.113549.1.9.1", signingTime: "1.2.840.113549.1.9.5" };

function campo(nome: pkijs.RelativeDistinguishedNames, oid: string): string[] {
  return nome.typesAndValues.filter((t) => t.type === oid).map((t) => String(t.value.valueBlock.value ?? ""));
}

function tipoDoCertificado(cert: pkijs.Certificate): Assinatura["tipo"] {
  const emissor = [...campo(cert.issuer, OID.cn), ...campo(cert.issuer, OID.ou), ...campo(cert.issuer, OID.o)].join(" ").toLowerCase();
  const titular = [...campo(cert.subject, OID.ou), ...campo(cert.subject, OID.o)].join(" ").toLowerCase();
  if (emissor.includes("governo federal") || emissor.includes("gov-br") || emissor.includes("govbr")) return "gov.br";
  if (emissor.includes("icp-brasil") || titular.includes("icp-brasil")) return "ICP-Brasil";
  return "outro";
}

/** Assinaturas de um PDF, na ordem em que foram feitas. */
export async function assinaturasDoPdf(pdf: Uint8Array): Promise<Assinatura[]> {
  const texto = Buffer.from(pdf).toString("latin1");
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  const vistas = new Set<string>();
  const saida: Assinatura[] = [];
  for (let m; (m = re.exec(texto)); ) {
    const [a, b, c, d] = m.slice(1, 5).map(Number);
    if (vistas.has(m[0]) || a !== 0 || c + d > pdf.length || b > c) continue;
    vistas.add(m[0]);
    // o /Contents fica entre os dois trechos assinados: <hex>
    const hex = texto.slice(b, c).replace(/^</, "").replace(/>$/, "").replace(/\s+/g, "");
    const der = Buffer.from(hex, "hex");
    const assinado = Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]);
    const r = await conferir(der, assinado, c + d >= pdf.length - 2);
    // sem signingTime na assinatura (ex.: Word), usa a data /M do dicionário da assinatura
    if (!r.quando) r.quando = dataDoDicionario(texto, m.index, c + 600);
    saida.push(r);
  }
  return saida;
}

async function conferir(der: Buffer, assinado: Buffer, cobreTudo: boolean): Promise<Assinatura> {
  const vazio: Assinatura = { nome: "—", cpf: null, email: null, emissor: "—", tipo: "outro", quando: null, integra: false, cobreTudo };
  try {
    const asn = asn1js.fromBER(new Uint8Array(der).buffer);
    if (asn.offset === -1) return { ...vazio, erro: "Assinatura ilegível." };
    const ci = new pkijs.ContentInfo({ schema: asn.result });
    const sd = new pkijs.SignedData({ schema: ci.content });
    const signer = sd.signerInfos[0];
    const certs = (sd.certificates ?? []).filter((x): x is pkijs.Certificate => x instanceof pkijs.Certificate);
    const sid = signer.sid as pkijs.IssuerAndSerialNumber;
    const cert = certs.find((x) => sid?.serialNumber && x.serialNumber.isEqual(sid.serialNumber)) ?? certs[0];
    let integra = false;
    try {
      const r = await sd.verify({ signer: 0, data: new Uint8Array(assinado).buffer, checkChain: false, extendedMode: true });
      integra = !!(typeof r === "object" ? r.signatureVerified : r);
    } catch {
      integra = false;
    }
    // hora da assinatura: atributo assinado signingTime (quando existir)
    let quando: string | null = null;
    const st = signer.signedAttrs?.attributes.find((x) => x.type === OID.signingTime);
    if (st) {
      const v = st.values[0] as asn1js.UTCTime | asn1js.GeneralizedTime;
      if (v && "toDate" in v) quando = v.toDate().toISOString();
    }
    if (!cert) return { ...vazio, integra, quando, erro: "Certificado não encontrado na assinatura." };
    const cn = campo(cert.subject, OID.cn)[0] ?? "—";
    const [nome, cpf] = cn.includes(":") ? [cn.split(":")[0], cn.split(":")[1]] : [cn, null];
    return {
      nome: nome.trim(), cpf: cpf && /^\d{11}$/.test(cpf) ? cpf : null,
      email: campo(cert.subject, OID.email)[0] ?? null,
      emissor: campo(cert.issuer, OID.cn)[0] ?? "—",
      tipo: tipoDoCertificado(cert), quando, integra, cobreTudo,
    };
  } catch (e) {
    return { ...vazio, erro: e instanceof Error ? e.message : "Falha ao ler a assinatura." };
  }
}

/** "/M (D:20260922141322-03'00')" mais próximo da assinatura. */
function dataDoDicionario(texto: string, pos: number, fim: number): string | null {
  const ini = texto.lastIndexOf("<<", pos);
  const trecho = texto.slice(Math.max(0, ini - 600), fim);
  const m = /\/M\s*\(D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(trecho);
  if (!m) return null;
  const [, a, mes, d, h, mi, s = "00", sinal = "Z", oh = "00", om = "00"] = m;
  const fuso = sinal === "Z" || sinal === "z" ? "Z" : `${sinal}${oh}:${om}`;
  const dt = new Date(`${a}-${mes}-${d}T${h}:${mi}:${s}${fuso}`);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

export const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
