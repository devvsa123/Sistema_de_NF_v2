import { ehInterno, usuarioAtual } from "@/lib/auth";
import { prazoReprovada } from "@/lib/fluxo";
import { buscarNotas, type Filtros } from "@/lib/notas";
import { cnpj, data, situacao } from "@/lib/format";

// Evita que o Excel interprete o conteúdo como fórmula
const cel = (v: unknown) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};

export async function GET(req: Request) {
  const u = await usuarioAtual();
  if (!u || u.deve_trocar_senha) return new Response("Não autorizado", { status: 401 });
  const f = Object.fromEntries(new URL(req.url).searchParams) as Filtros;
  const { linhas } = await buscarNotas(u, f, await prazoReprovada(), true);
  const interno = ehInterno(u);
  const cab = interno
    ? ["Nº NF", "Série", "Chave de acesso", "CNPJ", "Empresa", "Valor", "OC", "Situação", "Recebida em", "Concluída em", "Tempo total (dias)", "Arrecadada em", "Armazenada em"]
    : ["Nº NF", "Série", "Chave de acesso", "Valor", "OC", "Situação", "Recebida em", "Última movimentação", "Tempo total (dias)"];
  const corpo = linhas.map((n) =>
    (interno
      ? [n.numero, n.serie, n.chave, cnpj(n.emit_cnpj), n.emit_nome, Number(n.valor).toFixed(2).replace(".", ","), n.oc, situacao(n, false),
         data(n.recebida_em), n.concluida_em ? data(n.concluida_em) : "", Math.round(Number(n.dias_total)),
         n.arrecadada_em ? data(n.arrecadada_em) : "", n.armazenada_em ? data(n.armazenada_em) : ""]
      : [n.numero, n.serie, n.chave, Number(n.valor).toFixed(2).replace(".", ","), n.oc, situacao(n, true),
         data(n.recebida_em), data(n.etapa_desde), Math.round(Number(n.dias_total))]
    ).map(cel).join(";"),
  );
  return new Response("﻿" + [cab.map(cel).join(";"), ...corpo].join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="notas-fiscais.csv"', "Cache-Control": "private, no-store" },
  });
}
