"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acaoAvisos, acaoCiente, type AvisoTela } from "@/app/acoes/mencoes";
import { dataHora } from "@/lib/format";
import { JanelaComentarios } from "./ComentariosNota";

const INTERVALO = 20_000;

function bipe() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.18].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.15);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.16);
    });
  } catch { /* navegador sem áudio */ }
}

/** Avisos de mensagens: abre em destaque ao entrar no sistema e quando chega uma nova marcação. */
export function Avisos() {
  const [itens, setItens] = useState<AvisoTela[]>([]);
  const [total, setTotal] = useState(0);
  const [aberto, setAberto] = useState(false);
  const [respondendo, setRespondendo] = useState<AvisoTela | null>(null);
  const [pendente, iniciar] = useTransition();
  const vistos = useRef<Set<number> | null>(null);
  const router = useRouter();

  const atualizar = useCallback(async () => {
    try {
      const r = await acaoAvisos();
      setItens(r.itens);
      setTotal(r.total);
      const novos = r.itens.filter((a) => !vistos.current?.has(a.id));
      const primeira = vistos.current === null;
      vistos.current = new Set(r.itens.map((a) => a.id));
      if (novos.length) {
        setAberto(true);
        if (!primeira) bipe();
      }
      if (!r.total) setAberto(false);
    } catch { /* sem conexão: tenta de novo no próximo ciclo */ }
  }, []);

  useEffect(() => {
    const primeira = setTimeout(atualizar, 0);
    const t = setInterval(atualizar, INTERVALO);
    const foco = () => document.visibilityState === "visible" && atualizar();
    document.addEventListener("visibilitychange", foco);
    return () => { clearTimeout(primeira); clearInterval(t); document.removeEventListener("visibilitychange", foco); };
  }, [atualizar]);

  // título da aba piscando enquanto houver mensagens sem ciente
  useEffect(() => {
    if (!total) return;
    const original = document.title.replace(/^\(\d+\) .*? · /, "");
    let ligado = false;
    const t = setInterval(() => {
      ligado = !ligado;
      document.title = ligado ? `(${total}) Nova mensagem · ${original}` : original;
    }, 1500);
    return () => { clearInterval(t); document.title = original; };
  }, [total]);

  function ciente(ids: number[]) {
    iniciar(async () => {
      await acaoCiente(ids);
      await atualizar();
      router.refresh();
    });
  }

  if (!total && !respondendo) return null;

  return (
    <>
      {!aberto && total > 0 && (
        <button type="button" onClick={() => setAberto(true)}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-red-600 px-4 py-3 text-sm font-bold text-white shadow-xl ring-4 ring-red-200 hover:bg-red-700 print:hidden">
          <span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" /><span className="relative inline-flex h-3 w-3 rounded-full bg-white" /></span>
          {total} mensagem(ns) para você
        </button>
      )}

      {aberto && total > 0 && !respondendo && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-3 sm:p-6 print:hidden" role="presentation">
          <div role="alertdialog" aria-modal="true" aria-labelledby="avisos-titulo" className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-4 ring-red-500/40">
            <div className="flex items-center gap-3 bg-red-600 px-5 py-4 text-white">
              <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/30" />
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="relative h-6 w-6" aria-hidden>
                  <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
              </span>
              <div>
                <h2 id="avisos-titulo" className="text-lg font-bold">Você foi marcado em {total} mensagem(ns)</h2>
                <p className="text-sm text-red-100">Leia e dê ciente ou responda. Tudo fica registrado no histórico da NF.</p>
              </div>
            </div>

            <ol className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
              {itens.map((a) => (
                <li key={a.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm">
                      <Link href={`/notas/${a.notaId}`} onClick={() => setAberto(false)} className="font-bold text-marinha hover:underline">NF {a.numero}</Link>
                      <span className="text-slate-500"> · {a.empresa} · {a.etapa}</span>
                    </p>
                    <span className="text-xs text-slate-500">{dataHora(a.em)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    De <strong className="text-slate-800">{a.autor}</strong>
                    {a.setor ? <> para o setor <strong className="text-amber-800">{a.setor}</strong></> : " para você"}
                    {a.marcados && <span className="text-slate-400"> ({a.marcados})</span>}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap rounded-lg border-l-4 border-red-500 bg-red-50/60 px-3 py-2 text-[15px] text-slate-900">{a.texto}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className="botao h-8 px-3 text-xs" disabled={pendente} onClick={() => ciente([a.id])}>Ciente</button>
                    <button type="button" className="botao-sec h-8 px-3 text-xs" onClick={() => setRespondendo(a)}>Responder</button>
                    <Link href={`/notas/${a.notaId}`} onClick={() => setAberto(false)} className="botao-sec h-8 px-3 text-xs">Abrir NF</Link>
                  </div>
                </li>
              ))}
              {total > itens.length && <li className="px-5 py-3 text-center text-sm text-slate-500">e mais {total - itens.length} em <Link href="/mensagens" className="font-medium text-marinha underline" onClick={() => setAberto(false)}>Mensagens</Link></li>}
            </ol>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <Link href="/mensagens" onClick={() => setAberto(false)} className="text-sm font-medium text-marinha hover:underline">Ver todas as mensagens</Link>
              <div className="flex gap-2">
                <button type="button" className="botao-sec" onClick={() => setAberto(false)}>Ver depois</button>
                <button type="button" className="botao" disabled={pendente} onClick={() => ciente(itens.map((a) => a.id))}>Ciente de todas</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {respondendo && (
        <JanelaComentarios
          id={respondendo.notaId} numero={respondendo.numero} foco="comentar"
          marcadosIniciais={respondendo.autorId ? [`u:${respondendo.autorId}`] : []}
          fechar={() => { setRespondendo(null); atualizar(); }}
          aoRegistrar={() => { atualizar(); router.refresh(); }}
        />
      )}
    </>
  );
}
