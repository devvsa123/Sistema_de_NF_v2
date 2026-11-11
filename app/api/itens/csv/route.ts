import { ehInterno, usuarioAtual } from "@/lib/auth";
import { buscarItens, type FiltrosItens } from "@/lib/itens";
import { cnpj, data, situacao } from "@/lib/format";

const cel = (v: unknown) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};
const num = (v: number, casas = 2) => Number(v).toFixed(casas).replace(".", ",");

export async function GET(req: Request) {
  const u = await usuarioAtual();
  if (!u || u.deve_trocar_senha) return new Response("Não autorizado", { status: 401 });
  const f = Object.fromEntries(new URL(req.url).searchParams) as FiltrosItens;
  const { linhas } = await buscarItens(u, f, true);
  const interno = ehInterno(u);
  const cab = ["Nº NF", "CNPJ", "Empresa", "Situação", "Recebida em", "OC", "Item nº", "Código", "Descrição", "NCM", "Quantidade", "Unidade", "Valor unitário", "Valor total"];
  const corpo = linhas.map((i) =>
    [i.numero, cnpj(i.emit_cnpj), i.emit_nome, situacao(i, !interno), data(i.recebida_em), i.oc, i.n, i.codigo, i.descricao, i.ncm,
     num(i.qtd, 4).replace(/,?0+$/, ""), i.un, num(i.vunit, 4), num(i.vtotal)].map(cel).join(";"),
  );
  return new Response("﻿" + [cab.map(cel).join(";"), ...corpo].join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="itens-das-notas.csv"', "Cache-Control": "private, no-store" },
  });
}
