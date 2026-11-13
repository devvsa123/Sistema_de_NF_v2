"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { acaoDestinatarios } from "@/app/acoes/mencoes";
import type { Destinatarios } from "@/lib/mencoes";

let cache: Promise<Destinatarios> | null = null;
const carregar = () => (cache ??= acaoDestinatarios());

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Escolha de pessoas e setores a marcar na observação ("u:12", "s:Perícia"). */
export function Marcar({ valor, onChange, nomeCampo }: { valor: string[]; onChange: (v: string[]) => void; nomeCampo?: string }) {
  const [dados, setDados] = useState<Destinatarios | null>(null);
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    carregar().then((d) => vivo && setDados(d)).catch(() => { cache = null; });
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", fora);
    return () => { vivo = false; document.removeEventListener("mousedown", fora); };
  }, []);

  const opcoes = useMemo(() => {
    if (!dados) return [];
    const t = semAcento(busca.replace(/^@/, "").trim());
    const lista = [
      ...dados.setores.map((s) => ({ chave: `s:${s.nome}`, rotulo: s.nome, detalhe: `Setor · ${s.pessoas} pessoa(s)`, setor: true })),
      ...dados.usuarios.map((u) => ({ chave: `u:${u.id}`, rotulo: u.nome, detalhe: u.setores || "Sem setor", setor: false })),
    ];
    return lista.filter((o) => !valor.includes(o.chave) && (!t || semAcento(`${o.rotulo} ${o.detalhe}`).includes(t))).slice(0, 12);
  }, [dados, busca, valor]);

  const rotulo = (chave: string) => {
    if (chave.startsWith("s:")) return chave.slice(2);
    return dados?.usuarios.find((u) => `u:${u.id}` === chave)?.nome ?? "…";
  };

  function escolher(chave: string) {
    onChange([...valor, chave]);
    setBusca("");
    setAberto(false);
  }

  return (
    <div ref={caixa} className="relative">
      {nomeCampo && <input type="hidden" name={nomeCampo} value={JSON.stringify(valor)} />}
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1.5 focus-within:border-marinha focus-within:ring-2 focus-within:ring-marinha/20">
        <span className="text-sm font-semibold text-marinha">@</span>
        {valor.map((v) => (
          <span key={v} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${v.startsWith("s:") ? "bg-amber-100 text-amber-900" : "bg-blue-100 text-blue-900"}`}>
            {v.startsWith("s:") ? "Setor " : ""}{rotulo(v)}
            <button type="button" onClick={() => onChange(valor.filter((x) => x !== v))} className="rounded-full px-0.5 hover:bg-black/10" aria-label={`Remover ${rotulo(v)}`}>×</button>
          </span>
        ))}
        <input
          value={busca} onChange={(e) => { setBusca(e.target.value); setAberto(true); }} onFocus={() => setAberto(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && opcoes[0] && aberto) { e.preventDefault(); escolher(opcoes[0].chave); }
            if (e.key === "Backspace" && !busca && valor.length) onChange(valor.slice(0, -1));
            if (e.key === "Escape") setAberto(false);
          }}
          className="min-w-40 flex-1 border-0 bg-transparent p-0.5 text-sm outline-none" placeholder={valor.length ? "Marcar mais…" : "Marcar pessoa ou setor (opcional)"}
          aria-label="Marcar pessoa ou setor"
        />
      </div>
      {aberto && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {!dados ? <li className="px-3 py-2 text-sm text-slate-500">Carregando…</li>
            : !opcoes.length ? <li className="px-3 py-2 text-sm text-slate-500">Ninguém encontrado.</li>
            : opcoes.map((o) => (
              <li key={o.chave}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => escolher(o.chave)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-slate-50">
                  <span className="font-medium text-slate-800">{o.setor ? "Setor " : ""}{o.rotulo}</span>
                  <span className="truncate text-xs text-slate-500">{o.detalhe}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

/** Linha "Para: @…" exibida nos comentários marcados. */
export function ParaQuem({ marcados }: { marcados: string | null }) {
  if (!marcados) return null;
  return <p className="mt-1 inline-flex rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">Para: {marcados}</p>;
}
