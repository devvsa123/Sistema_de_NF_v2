"use client";

import { useMemo, useState } from "react";

type Linha = { ref: string; n: number; item: string; pi: string | null; qtd: number; un: string; cxp: number | null; volumes: number | null; pesar: number | null; ac: number; re: number };
type Nf = { id: number; numero: string; empresa: string; etapa: string; recebida: string; linhas: Linha[]; volumes: number; pesar: number; semCxp: number };

const n = (v: number) => v.toLocaleString("pt-BR");
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—");

/** Levantamento por NF e item, escolha das NF que ficam com contagem 100% e geração do plano em PDF. */
export function PlanoPesagem({ nfs, etapas }: { nfs: Nf[]; etapas: number[] }) {
  const [fora, setFora] = useState<Set<number>>(new Set());
  const [tol, setTol] = useState("2");
  const [aberta, setAberta] = useState<number | null>(null);
  const alternar = (id: number) => setFora((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const res = useMemo(() => {
    const no = nfs.filter((x) => !fora.has(x.id));
    const vol = no.reduce((s, x) => s + x.volumes, 0), pesar = no.reduce((s, x) => s + x.pesar, 0);
    return { no: no.length, vol, pesar, volFora: nfs.filter((x) => fora.has(x.id)).reduce((s, x) => s + x.volumes, 0), semCxp: no.reduce((s, x) => s + x.semCxp, 0) };
  }, [nfs, fora]);
  const url = `/api/amostragem/plano?etapas=${etapas.join(",")}&excluir=${[...fora].join(",")}&tol=${encodeURIComponent(tol)}`;

  if (!nfs.length) return <p className="cartao p-5 text-sm text-slate-500">Nenhuma NF com itens nas etapas escolhidas.</p>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[["NF no plano", `${res.no} de ${nfs.length}`], ["Volumes no plano", n(res.vol)], ["Volumes a pesar", n(res.pesar)],
          ["Deixam de ser contados 1 a 1", `${n(res.vol - res.pesar)} (${pct(res.vol - res.pesar, res.vol)})`], ["Contagem 100%", `${fora.size} NF · ${n(res.volFora)} vol. + ${res.semCxp} item(ns) sem CXP`]].map(([t, v]) => (
          <div key={t} className="cartao p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t}</p><p className="mt-1 text-lg font-bold text-slate-900">{v}</p></div>
        ))}
      </div>

      <div className="cartao flex flex-wrap items-end justify-between gap-3 p-4">
        <label className="text-sm"><span className="rotulo">Tolerância de peso por volume (± %)</span>
          <input value={tol} onChange={(e) => setTol(e.target.value)} inputMode="decimal" maxLength={4} className="campo h-9 w-24" /></label>
        <p className="max-w-xl text-xs text-slate-500">Marque <strong>Contagem 100%</strong> nas NF que devem continuar com contagem completa. O plano em PDF traz o resumo, a metodologia, o plano por NF e item e o campo de aprovação do Diretor.</p>
        <a href={url} target="_blank" rel="noopener" className="botao">Gerar plano (PDF)</a>
      </div>

      <div className="cartao overflow-x-auto">
        <table className="tabela">
          <thead><tr><th>Contagem 100%</th><th>NF</th><th>Empresa</th><th>Etapa</th><th className="text-right">Itens</th><th className="text-right">Volumes</th><th className="text-right">A pesar</th><th className="text-right">Sem CXP</th><th /></tr></thead>
          <tbody>
            {nfs.map((x) => {
              const ex = fora.has(x.id);
              return [
                <tr key={x.id} className={ex ? "bg-slate-50 text-slate-400" : ""}>
                  <td><input type="checkbox" checked={ex} onChange={() => alternar(x.id)} aria-label={`Manter a NF ${x.numero} com contagem 100%`} /></td>
                  <td className="font-semibold"><a href={`/notas/${x.id}`} target="_blank" rel="noopener" className="text-marinha hover:underline">{x.numero}</a></td>
                  <td className="max-w-56 truncate">{x.empresa}</td>
                  <td className="whitespace-nowrap text-xs">{x.etapa}</td>
                  <td className="text-right tabular-nums">{x.linhas.length}</td>
                  <td className="text-right tabular-nums">{n(x.volumes)}</td>
                  <td className="text-right font-semibold tabular-nums">{ex ? "100%" : n(x.pesar)}</td>
                  <td className={`text-right tabular-nums ${x.semCxp ? "text-amber-700" : ""}`}>{x.semCxp || "—"}</td>
                  <td><button type="button" className="text-xs font-medium text-marinha hover:underline" onClick={() => setAberta(aberta === x.id ? null : x.id)}>{aberta === x.id ? "Ocultar itens" : "Ver itens"}</button></td>
                </tr>,
                aberta === x.id && (
                  <tr key={`${x.id}-i`}><td colSpan={9} className="bg-slate-50/70">
                    <table className="tabela text-xs">
                      <thead><tr><th>#</th><th>Item</th><th>PI</th><th className="text-right">Qtd. NF</th><th className="text-right">CXP</th><th className="text-right">Volumes</th><th className="text-right">Pesar</th><th className="text-center">Ac</th><th className="text-center">Re</th></tr></thead>
                      <tbody>{x.linhas.map((l) => (
                        <tr key={l.ref}><td>{l.n}</td><td className="min-w-64">{l.item}</td><td className="font-mono">{l.pi ?? "—"}</td><td className="text-right">{n(l.qtd)} {l.un}</td>
                          <td className="text-right">{l.cxp ?? "—"}</td><td className="text-right">{l.volumes ?? "—"}</td>
                          <td className="text-right font-semibold">{l.pesar ?? <span className="text-amber-700">100%</span>}</td><td className="text-center">{l.volumes ? l.ac : "—"}</td><td className="text-center">{l.volumes ? l.re : "—"}</td></tr>
                      ))}</tbody>
                    </table>
                  </td></tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
