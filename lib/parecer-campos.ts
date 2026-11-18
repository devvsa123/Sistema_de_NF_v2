/** Campos de assinatura do Parecer da Divisão Técnica (usados no servidor e no navegador). */

export const CAMPO_PERITO = "Perito Avaliador";

export type Decisao = { titulo: string; opcoes: string[]; setor: string; palavras: string[] };

/** Campos em que quem assina também decide; a decisão fica gravada dentro da assinatura. */
export const DECISOES: Record<string, Decisao> = {
  "Encarregado da Divisao Tecnica": {
    titulo: "PARECER DO ENCARREGADO DA DIVISÃO TÉCNICA",
    opcoes: ["Aprovado", "Reprovado", "Aprovado por Decisão Gerencial"],
    setor: "Enc. Técnica",
    palavras: ["técnica", "tecnica"],
  },
  "Resolucao do Diretor": {
    titulo: "RESOLUÇÃO DO SR. DIRETOR",
    opcoes: ["Arrecadar", "Não Arrecadar", "Arrecadar Parcialmente"],
    setor: "Diretor",
    palavras: ["diretor"],
  },
};

export type DecisaoEscolhida = { opcao: number; observacao: string };

export const INDICACAO: Record<string, string> = { pericia: "Reprovada na perícia", tecnica: "Reprovação indicada pela Técnica" };
