/**
 * Leitura da chave de acesso da NF-e (44 dígitos). Funciona sem internet:
 * cUF(2) AAMM(4) CNPJ(14) modelo(2) série(3) número(9) tpEmis(1) cNF(8) DV(1).
 */

const UF: Record<string, string> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO", "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB",
  "26": "PE", "27": "AL", "28": "SE", "29": "BA", "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS", "50": "MS",
  "51": "MT", "52": "GO", "53": "DF",
};
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function digitoVerificadorOk(chave: string) {
  if (!/^\d{44}$/.test(chave)) return false;
  let soma = 0, peso = 2;
  for (let i = 42; i >= 0; i--) {
    soma += Number(chave[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const dv = 11 - (soma % 11);
  return (dv >= 10 ? 0 : dv) === Number(chave[43]);
}

export type ChaveLida = { uf: string; emissao: string; cnpj: string; modelo: string; serie: string; numero: string };

/** Devolve os dados da chave ou uma mensagem explicando o problema. */
export function lerChave(texto: string): { ok: true; dados: ChaveLida } | { ok: false; erro: string } {
  const c = texto.replace(/\D/g, "");
  if (c.length !== 44) return { ok: false, erro: `A chave tem 44 dígitos (foram digitados ${c.length}).` };
  if (!digitoVerificadorOk(c)) return { ok: false, erro: "Chave inválida: o dígito verificador não confere. Confira se algum número foi digitado errado." };
  const mes = Number(c.slice(4, 6));
  if (!UF[c.slice(0, 2)] || mes < 1 || mes > 12) return { ok: false, erro: "Chave inválida: estado ou mês de emissão não existem." };
  return {
    ok: true,
    dados: {
      uf: UF[c.slice(0, 2)],
      emissao: `${MESES[mes - 1]} de 20${c.slice(2, 4)}`,
      cnpj: c.slice(6, 20),
      modelo: c.slice(20, 22) === "55" ? "NF-e (modelo 55)" : c.slice(20, 22) === "65" ? "NFC-e (modelo 65)" : `modelo ${c.slice(20, 22)}`,
      serie: String(Number(c.slice(22, 25))),
      numero: String(Number(c.slice(25, 34))),
    },
  };
}
