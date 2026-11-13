"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { acaoItensNota } from "@/app/acoes/itens";
import { numero as fmt } from "@/lib/format";

const SELO: Record<string, [string, string]> = {
  pi: ["PI na nota", "bg-emerald-50 text-emerald-700 ring-emerald-200"],
  confirmada: ["Confirmada", "bg-emerald-50 text-emerald-700 ring-emerald-200"],
  alta: ["Automática", "bg-sky-50 text-sky-700 ring-sky-200"],
  media: ["Verificar", "bg-amber-50 text-amber-800 ring-amber-200"],
  nenhuma: ["Sem correlação", "bg-red-50 text-red-700 ring-red-200"],
};
const q = (v: number) => fmt(v, Number.isInteger(v) ? 0 : 2);

/** Botão "Itens" da fila: abre a lista de itens da NF com o item do estoque, CXP e caixas, sem sair da fila. */
export function ItensRapidos({ id, numero, volta }: { id: number; numero: string; volta?: string }) {
  const [aberto, setAberto] = useState(false);
  const fechar = useCallback(() => setAberto(false), []);
  return (
    <>
      <button type="button" onClick={() => setAberto(true)} title={`Ver os itens da NF ${numero}`}
        className="ml-2 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:border-marinha hover:text-marinha">
        Itens
      </button>
      {aberto && <Janela id={id} numero={numero} volta={volta} fechar={fechar} />}
    </>
  );
}

function Janela({ id, numero, volta, fechar }: { id: number; numero: string; volta?: string; fechar: () => void }) {
  const [r, setR] = useState<Awaited<ReturnType<typeof acaoItensNota>> | null>(null);
  useEffect(() => {
    acaoItensNota(id).then(setR);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && fechar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [id, fechar]);

  const itens = r?.itens ?? [];
  const tot = itens.reduce((a, l) => ({ total: a.total + (l.total ?? 0), cheias: a.cheias + (l.cheias ?? 0), frac: a.frac + (l.fracionada ? 1 : 0) }), { total: 0, cheias: 0, frac: 0 });
  const sem = itens.filter((l) => !l.pi).length;
  const semCxp = itens.filter((l) => l.pi && l.total === null).length;
  const link = `/notas/${id}${volta ? `?volta=${encodeURIComponent(volta)}` : ""}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onClick={fechar} role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby={`itens-${id}`} onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id={`itens-${id}`} className="text-[15px] font-semibold text-slate-900">Itens da NF {numero} × estoque (WMS)</h2>
            <p className="text-xs text-slate-500">{r?.empresa ?? "…"}{r?.idPa ? ` · ID de PA ${r.idPa}` : ""}</p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            {r && itens.length > 0 && (
              <>
                <p><span className="block text-xs text-slate-500">Caixas pelo padrão</span><strong>{tot.total}</strong> <span className="text-xs text-slate-500">({tot.cheias} cheias{tot.frac ? ` + ${tot.frac} fracion.` : ""})</span></p>
                <p><span className="block text-xs text-slate-500">Volumes na NF</span><strong>{r.volumes || "—"}</strong></p>
              </>
            )}
            <button type="button" onClick={fechar} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label="Fechar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" className="h-5 w-5" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {!r ? <p className="py-10 text-center text-sm text-slate-500">Carregando…</p>
            : r.erro ? <p className="py-10 text-center text-sm text-red-700">{r.erro}</p>
            : !itens.length ? <p className="py-10 text-center text-sm text-slate-500">Esta NF não tem itens cadastrados (sem XML/PDF da NF-e).</p>
            : (
              <table className="tabela text-[13px] [&_td]:px-2.5 [&_th]:px-2.5">
                <thead className="sticky top-0 bg-white">
                  <tr><th>#</th><th>Item da NF</th><th className="text-right">Qtd.</th><th>Item no estoque (WMS)</th><th>Correlação</th><th className="text-right">CXP</th><th className="text-right">Cheias</th><th className="text-right">Fracion.</th><th className="text-right">Total cx.</th></tr>
                </thead>
                <tbody>
                  {itens.map((l) => {
                    const [rot, cor] = SELO[l.confianca] ?? SELO.nenhuma;
                    return (
                      <tr key={l.ref}>
                        <td className="text-slate-500">{l.n}</td>
                        <td className="min-w-48 max-w-64 whitespace-normal">
                          {l.tamanho ? <span>↳ Tamanho <strong>{l.tamanho}</strong></span> : l.descricao}
                          {l.grade && <span className="block text-[11px] text-slate-500">{l.grade}</span>}
                        </td>
                        <td className="whitespace-nowrap text-right tabular-nums">{q(l.qtd)} {l.un}</td>
                        <td className="min-w-52 max-w-72 whitespace-normal">{l.pi ? <><span className="font-mono text-xs text-slate-500">{l.pi}</span> {l.estoque}</> : <span className="text-red-700">Nenhum item correspondente</span>}</td>
                        <td><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${cor}`}>{rot}</span></td>
                        <td className="text-right tabular-nums">{l.cxp ? q(l.cxp) : "—"}</td>
                        <td className="text-right tabular-nums">{l.cheias ?? "—"}</td>
                        <td className="whitespace-nowrap text-right tabular-nums">{l.fracionada ? `1 c/ ${q(l.fracionada)}` : "—"}</td>
                        <td className="text-right font-semibold tabular-nums">{l.total ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs">
          <span className="text-slate-600">
            {r?.catalogoVazio ? "O catálogo do estoque ainda não foi carregado." : sem || semCxp ? `${sem ? `${sem} sem correlação` : ""}${sem && semCxp ? " · " : ""}${semCxp ? `${semCxp} sem CXP no WMS` : ""}. Para corrigir, abra a NF.` : "Todos os itens ligados ao estoque."}
          </span>
          <Link href={link} className="botao-sec h-8 px-3 text-xs">Abrir NF e corrigir correlação</Link>
        </div>
      </div>
    </div>
  );
}
