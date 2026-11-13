"use server";

import { exigirUsuario } from "@/lib/auth";
import { obterNota } from "@/lib/notas";
import { correlacionarNota } from "@/lib/estoque";

export type ItemRapido = {
  ref: string; n: number; descricao: string; tamanho?: string; qtd: number; un: string; confianca: string;
  pi: string | null; estoque: string | null; cxp: number | null; cheias: number | null; fracionada: number; total: number | null; grade?: string;
};

/** Itens da NF ligados ao estoque (WMS), para a consulta rápida da fila. */
export async function acaoItensNota(id: number): Promise<{ erro?: string; numero?: string; empresa?: string; idPa?: string | null; volumes?: number; catalogoVazio?: boolean; itens: ItemRapido[] }> {
  const u = await exigirUsuario();
  if (u.papel !== "admin" && u.papel !== "interno") return { erro: "Seu perfil não permite esta consulta.", itens: [] };
  const nota = await obterNota(u, Number(id));
  if (!nota) return { erro: "NF não encontrada.", itens: [] };
  const volumes = (nota.dados?.transp?.volumes ?? []).reduce((s, v) => s + (Number(v.qVol) || 0), 0);
  const base = { numero: nota.numero, empresa: nota.emit_nome, idPa: nota.id_pa, volumes };
  if (!nota.itens?.length) return { ...base, itens: [] };
  const { linhas, catalogoVazio } = await correlacionarNota(nota);
  if (catalogoVazio)
    return { ...base, catalogoVazio: true, itens: nota.itens.map((i) => ({ ref: String(i.n), n: i.n, descricao: i.descricao, qtd: i.qtd, un: i.un, confianca: "nenhuma", pi: null, estoque: null, cxp: null, cheias: null, fracionada: 0, total: null })) };
  return {
    ...base,
    itens: linhas.map((l) => ({
      ref: l.ref, n: l.n, descricao: l.descricao, tamanho: l.tamanho, qtd: l.qtd, un: l.un, confianca: l.confianca,
      pi: l.item?.pi ?? null, estoque: l.item?.descricao ?? null, cxp: l.item?.cxp ?? null,
      cheias: l.caixas?.cheias ?? null, fracionada: l.caixas?.fracionada ?? 0, total: l.caixas?.total ?? null,
      grade: l.grade ? `Grade em ${l.grade.tamanhos} tamanho(s) · soma ${l.grade.qtdGrade} de ${l.grade.qtdItem}` : undefined,
    })),
  };
}
