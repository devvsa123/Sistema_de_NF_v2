"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acaoComentar, acaoComentarios, type Comentario } from "@/app/acoes/notas";
import { dataHora } from "@/lib/format";

const COR: Record<string, string> = {
  observacao: "bg-sky-50 text-sky-700 ring-sky-200",
  reprovacao: "bg-red-50 text-red-700 ring-red-200",
  retorno: "bg-amber-50 text-amber-800 ring-amber-200",
};

/** Botões da fila: registrar observação na NF e abrir a janela com todos os comentários dela. */
export function ComentariosNota({ id, numero, total }: { id: number; numero: string; total: number }) {
  const [aberto, setAberto] = useState<null | "comentar" | "ver">(null);
  const fechar = useCallback(() => setAberto(null), []);
  return (
    <>
      <span className="inline-flex flex-wrap gap-1.5 whitespace-nowrap">
        <button type="button" onClick={() => setAberto("comentar")} title={`Registrar observação na NF ${numero}`}
          className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:border-marinha hover:text-marinha">
          + Observação
        </button>
        <button type="button" onClick={() => setAberto("ver")} title={`Ver todos os comentários da NF ${numero}`}
          className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:border-marinha hover:text-marinha">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
          </svg>
          Comentários{total ? ` (${total})` : ""}
        </button>
      </span>
      {aberto && <Janela id={id} numero={numero} foco={aberto} fechar={fechar} />}
    </>
  );
}

function Janela({ id, numero, foco, fechar }: { id: number; numero: string; foco: "comentar" | "ver"; fechar: () => void }) {
  const [itens, setItens] = useState<Comentario[] | null>(null);
  const [obsOc, setObsOc] = useState<string | undefined>();
  const [erro, setErro] = useState("");
  const [texto, setTexto] = useState("");
  const [salvo, setSalvo] = useState(false);
  const [pendente, iniciar] = useTransition();
  const campo = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  useEffect(() => {
    acaoComentarios(id).then((r) => { setItens(r.itens); setObsOc(r.obsOc); setErro(r.erro ?? ""); });
  }, [id]);
  useEffect(() => {
    if (foco === "comentar") campo.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && fechar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [foco, fechar]);

  function enviar() {
    if (!texto.trim()) return;
    iniciar(async () => {
      const r = await acaoComentar(id, texto);
      if (r.erro) return setErro(r.erro);
      setItens(r.itens);
      setTexto("");
      setErro("");
      setSalvo(true);
      router.refresh(); // atualiza a coluna "Última observação" e o contador
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onClick={fechar} role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby={`coment-${id}`} onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id={`coment-${id}`} className="text-[15px] font-semibold text-slate-900">Comentários da NF {numero}</h2>
            <p className="text-xs text-slate-500">Observações e registros da tramitação, do mais recente para o mais antigo.</p>
          </div>
          <button type="button" onClick={fechar} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label="Fechar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" className="h-5 w-5" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
          <label className="block">
            <span className="rotulo">Nova observação</span>
            <textarea ref={campo} value={texto} onChange={(e) => { setTexto(e.target.value); setSalvo(false); }} rows={2} maxLength={2000}
              className="campo" placeholder="Escreva a observação e clique em Registrar"
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) enviar(); }} />
          </label>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500">{salvo ? <span className="text-emerald-700">Observação registrada.</span> : "Fica no histórico da NF, com seu nome e a data."}</span>
            <button type="button" className="botao" onClick={enviar} disabled={pendente || !texto.trim()}>{pendente ? "Registrando…" : "Registrar"}</button>
          </div>
          {erro && <p className="mt-2 text-sm text-red-700">{erro}</p>}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {obsOc && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="text-xs font-semibold uppercase tracking-wide">Observação da OC</span>
              <p className="whitespace-pre-wrap">{obsOc}</p>
            </div>
          )}
          {itens === null ? <p className="py-6 text-center text-sm text-slate-500">Carregando…</p>
            : itens.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">Nenhum comentário nesta NF ainda.</p>
            : (
              <ol className="divide-y divide-slate-100">
                {itens.map((c) => (
                  <li key={c.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                      <span className={`rounded-full px-2 py-0.5 font-medium ring-1 ${COR[c.tipo] ?? "bg-slate-50 text-slate-600 ring-slate-200"}`}>{c.titulo}</span>
                      <span className="font-medium text-slate-700">{c.usuario}</span>
                      <span>{dataHora(c.em)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{c.texto}</p>
                  </li>
                ))}
              </ol>
            )}
        </div>
      </div>
    </div>
  );
}
