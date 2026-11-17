"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { acaoConcluirAssinatura, acaoDocumentosParaAssinar, acaoIdentificarCertificado, acaoPrepararDocumento } from "@/app/acoes/assinador";
import type { DocParaAssinar } from "@/lib/assinador";
import { dataHora } from "@/lib/format";
import { assinarResumo, conectar, resumoAleatorio, TUTORIAL_AUTORIZAR } from "./serpro-cliente";

/**
 * "Documentos do processo": todos os documentos da NF num só lugar, com visualização página a página e
 * assinatura com o token de um ou vários documentos de uma vez (no campo próprio ou no ponto clicado da página).
 */

const SELO = { w: 200, h: 52 }; // tamanho do selo em pontos (igual ao do servidor)

// campo sugerido conforme o setor de quem assina
const PALAVRAS: Record<string, string[]> = {
  estocagem: ["armazenagem"], controle: ["suprimentos"], "perícia": ["perito"], pericia: ["perito"],
  abastecimento: ["gestor"], recebimento: ["pre-recebimento", "pré-recebimento", "conferente"],
};

type Alvo = { campo: string } | { pagina: number; x: number; y: number };
type Estado = { alvo?: Alvo; status?: "ok" | "erro" | "assinando"; msg?: string };
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPagina> };
type PdfPagina = {
  getViewport: (o: { scale: number }) => { width: number; height: number; convertToPdfPoint: (x: number, y: number) => number[]; convertToViewportPoint: (x: number, y: number) => number[] };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
};

export function BotaoDocumentos({ notaId, numero, total, faltando = "", rotulo, className }: { notaId: number; numero: string; total: number; faltando?: string; rotulo?: string; className?: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAberto(true)} title={faltando ? `Falta anexar: ${faltando}` : `${total} documento(s)`}
        className={className ?? `ml-2 rounded border px-1.5 py-0.5 text-[11px] font-medium ${faltando ? "border-red-300 bg-red-50 text-red-700 hover:border-red-500" : "border-slate-200 text-slate-600 hover:border-marinha hover:text-marinha"}`}>
        {rotulo ?? <>Docs{total ? ` (${total})` : ""}{faltando ? " !" : ""}</>}
      </button>
      {aberto && <Painel notaId={notaId} numero={numero} fechar={() => setAberto(false)} />}
    </>
  );
}

function sugerido(d: DocParaAssinar, setores: string[]) {
  const livres = d.campos.filter((c) => !c.assinado);
  const chaves = setores.flatMap((s) => PALAVRAS[s.toLowerCase()] ?? []);
  return livres.find((c) => chaves.some((k) => `${c.nome} ${c.rotulo}`.toLowerCase().includes(k)))?.nome ?? "";
}

function Painel({ notaId, numero, fechar }: { notaId: number; numero: string; fechar: () => void }) {
  const [docs, setDocs] = useState<DocParaAssinar[] | null>(null);
  const [setores, setSetores] = useState<string[]>([]);
  const [erro, setErro] = useState("");
  const [atual, setAtual] = useState<number | null>(null);
  const [marcados, setMarcados] = useState<Record<number, Estado>>({});
  const [assinando, setAssinando] = useState(false);
  const [aviso, setAviso] = useState("");
  const router = useRouter();

  const carregar = useCallback(async () => {
    const r = await acaoDocumentosParaAssinar(notaId);
    if (r.erro) { setErro(r.erro); return; }
    setDocs(r.docs); setSetores(r.setores ?? []);
    setAtual((a) => (a && r.docs.some((d) => d.id === a) ? a : r.docs[0]?.id ?? null));
  }, [notaId]);

  useEffect(() => {
    const t = setTimeout(carregar, 0);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !assinando && fechar();
    window.addEventListener("keydown", esc);
    return () => { clearTimeout(t); window.removeEventListener("keydown", esc); };
  }, [carregar, fechar, assinando]);

  const doc = docs?.find((d) => d.id === atual) ?? null;
  const marcar = (d: DocParaAssinar, sim: boolean) => setMarcados((m) => {
    const n = { ...m };
    if (sim) { const c = sugerido(d, setores); n[d.id] = { alvo: c ? { campo: c } : undefined }; } else delete n[d.id];
    return n;
  });
  const escolhidos = Object.entries(marcados).filter(([, e]) => e.status !== "ok").map(([id]) => Number(id));
  const prontos = escolhidos.every((id) => marcados[id]?.alvo);

  async function assinarTodos() {
    if (!docs || !escolhidos.length || !prontos) return;
    setAssinando(true); setAviso("");
    const ws: { atual: WebSocket | null } = { atual: null };
    try {
      try { ws.atual = await conectar(); } catch {
        setAviso("Não foi possível falar com o Assinador SERPRO. Confira se ele está aberto e autorizado neste navegador.");
        return;
      }
      for (const id of escolhidos) {
        const e = marcados[id];
        setMarcados((m) => ({ ...m, [id]: { ...m[id], status: "assinando", msg: "" } }));
        try {
          let feito = false;
          for (let tentativa = 0; tentativa < 3 && !feito; tentativa++) {
            let p = await acaoPrepararDocumento(id, e.alvo!);
            if ("identificar" in p) {
              setAviso("Primeira assinatura pelo sistema: o Assinador vai pedir o PIN uma vez para identificar o seu certificado.");
              const s0 = await assinarResumo(ws, await resumoAleatorio());
              if (!s0) throw new Error("Assinatura cancelada no Assinador.");
              const idt = await acaoIdentificarCertificado(s0);
              if ("erro" in idt && idt.erro) throw new Error(idt.erro);
              p = await acaoPrepararDocumento(id, e.alvo!);
            }
            if ("erro" in p && p.erro) throw new Error(p.erro);
            const { id: sessao, resumo } = p as { id: number; resumo: string };
            const sig = await assinarResumo(ws, resumo);
            if (!sig) throw new Error("Assinatura cancelada no Assinador.");
            const c = await acaoConcluirAssinatura(sessao, sig);
            if ("refazer" in c && c.refazer) { setAviso("O certificado mudou: o selo foi atualizado e o Assinador vai pedir o PIN de novo."); continue; }
            if (c.erro) throw new Error(c.erro);
            setMarcados((m) => ({ ...m, [id]: { ...m[id], status: "ok", msg: c.ok } }));
            feito = true;
          }
          if (!feito) throw new Error("Não foi possível concluir a assinatura.");
        } catch (err) {
          setMarcados((m) => ({ ...m, [id]: { ...m[id], status: "erro", msg: err instanceof Error ? err.message : "Erro." } }));
        }
      }
    } finally {
      ws.atual?.close();
      setAssinando(false);
      await carregar();
      router.refresh();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/50 sm:p-4" role="presentation" onClick={() => !assinando && fechar()}>
      <div role="dialog" aria-modal="true" aria-labelledby="docs-titulo" onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-7xl flex-col overflow-hidden bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <div>
            <h2 id="docs-titulo" className="text-[15px] font-semibold text-slate-900">Documentos do processo — NF {numero}</h2>
            <p className="text-xs text-slate-500">Veja todos os documentos e assine com o token um ou vários de uma vez.</p>
          </div>
          <button type="button" onClick={fechar} disabled={assinando} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Fechar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" className="h-5 w-5" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* lista */}
          <div className="flex max-h-[45%] w-full shrink-0 flex-col border-b border-slate-200 lg:max-h-none lg:w-96 lg:border-b-0 lg:border-r">
            <div className="min-h-0 flex-1 overflow-y-auto">
              {erro ? <p className="p-4 text-sm text-red-700">{erro}</p>
                : !docs ? <p className="p-4 text-sm text-slate-500">Carregando…</p>
                : !docs.length ? <p className="p-4 text-sm text-slate-500">Nenhum documento em PDF anexado a esta NF.</p>
                : (
                  <ul className="divide-y divide-slate-100">
                    {docs.map((d) => {
                      const e = marcados[d.id];
                      const livres = d.campos.filter((c) => !c.assinado);
                      return (
                        <li key={d.id} className={`px-3 py-2.5 ${atual === d.id ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                          <div className="flex items-start gap-2">
                            <input type="checkbox" className="mt-1" checked={!!e} disabled={assinando || e?.status === "ok"} onChange={(ev) => marcar(d, ev.target.checked)} aria-label={`Assinar ${d.nome}`} />
                            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setAtual(d.id)}>
                              <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{d.tipo}</span>
                              <span className="block truncate text-sm font-medium text-slate-900" title={d.nome}>{d.nome}</span>
                              <span className="block text-[11px] text-slate-500">
                                {d.assinaturas.length ? `Assinado por: ${[...new Set(d.assinaturas)].join(", ")}` : "Sem assinatura"} · {dataHora(d.criado_em)}
                              </span>
                              {d.campos.length > 0 && <span className="block text-[11px] text-slate-500">Campos: {d.campos.map((c) => `${c.rotulo}${c.assinado ? " ✔" : ""}`).join(" · ")}</span>}
                            </button>
                          </div>
                          {e && e.status !== "ok" && (
                            <div className="ml-6 mt-1.5 text-xs">
                              {livres.length > 0 ? (
                                <select className="campo h-8 py-0 text-xs" value={e.alvo && "campo" in e.alvo ? e.alvo.campo : ""} disabled={assinando}
                                  onChange={(ev) => setMarcados((m) => ({ ...m, [d.id]: { ...m[d.id], alvo: ev.target.value ? { campo: ev.target.value } : undefined } }))}>
                                  <option value="">Escolha o campo da sua assinatura…</option>
                                  {livres.map((c) => <option key={c.nome} value={c.nome}>{c.rotulo}</option>)}
                                  <option value="" disabled>──</option>
                                </select>
                              ) : e.alvo && "pagina" in e.alvo ? (
                                <span className="text-emerald-700">Posição escolhida na página {e.alvo.pagina + 1}. <button type="button" className="underline" onClick={() => setAtual(d.id)}>mudar</button></span>
                              ) : (
                                <span className="text-amber-700">Clique na página, à direita, onde a sua assinatura deve ficar.</span>
                              )}
                            </div>
                          )}
                          {e?.status === "assinando" && <p className="ml-6 mt-1 text-xs text-blue-800">Assinando… confirme no Assinador SERPRO.</p>}
                          {e?.status === "ok" && <p className="ml-6 mt-1 text-xs text-emerald-700">✔ {e.msg}</p>}
                          {e?.status === "erro" && <p className="ml-6 mt-1 text-xs text-red-700">{e.msg}</p>}
                        </li>
                      );
                    })}
                  </ul>
                )}
            </div>
            <div className="space-y-2 border-t border-slate-200 bg-slate-50 p-3">
              {aviso && <p className="text-xs text-amber-800">{aviso} <a href={TUTORIAL_AUTORIZAR} target="_blank" rel="noopener" className="underline">ajuda</a></p>}
              <button type="button" className="botao w-full" disabled={assinando || !escolhidos.length || !prontos} onClick={assinarTodos}>
                {assinando ? "Assinando…" : escolhidos.length ? `Assinar ${escolhidos.length} documento(s) com o token` : "Marque os documentos para assinar"}
              </button>
              {escolhidos.length > 0 && !prontos && <p className="text-[11px] text-slate-500">Falta escolher o campo ou a posição da assinatura em algum documento marcado.</p>}
            </div>
          </div>

          {/* visualização */}
          <div className="min-h-0 flex-1 overflow-auto bg-slate-100">
            {doc ? (
              <Visualizador key={doc.id} documentoId={doc.id}
                posicao={(() => { const a = marcados[doc.id]?.alvo; return a && "pagina" in a ? a : null; })()}
                escolherPosicao={!!marcados[doc.id] && marcados[doc.id].status !== "ok" && !doc.campos.some((c) => !c.assinado)}
                aoEscolher={(alvo) => setMarcados((m) => ({ ...m, [doc.id]: { ...m[doc.id], alvo } }))} />
            ) : <p className="p-6 text-sm text-slate-500">Escolha um documento à esquerda.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Visualizador({ documentoId, posicao, escolherPosicao, aoEscolher }: {
  documentoId: number; posicao: { pagina: number; x: number; y: number } | null; escolherPosicao: boolean; aoEscolher: (a: { pagina: number; x: number; y: number }) => void;
}) {
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [erro, setErro] = useState("");
  const [pagina, setPagina] = useState(posicao?.pagina ?? 0);
  const [escala, setEscala] = useState(1);
  const [marca, setMarca] = useState<{ left: number; top: number } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const viewport = useRef<ReturnType<PdfPagina["getViewport"]> | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
        const d = await pdfjs.getDocument({ url: `/api/documentos/${documentoId}` }).promise;
        if (vivo) setPdf(d as unknown as PdfDoc);
      } catch {
        if (vivo) setErro("Não foi possível abrir este PDF aqui. Use “Abrir em nova aba”.");
      }
    })();
    return () => { vivo = false; };
  }, [documentoId]);

  useEffect(() => {
    if (!pdf || !canvas.current || !caixa.current) return;
    let cancelado = false;
    (async () => {
      const p = await pdf.getPage(pagina + 1);
      const largura = Math.min(caixa.current!.clientWidth - 32, 900);
      const base = p.getViewport({ scale: 1 });
      const esc = largura / base.width;
      const vp = p.getViewport({ scale: esc });
      viewport.current = vp;
      const dpr = window.devicePixelRatio || 1;
      const cv = canvas.current!;
      cv.width = Math.floor(vp.width * dpr); cv.height = Math.floor(vp.height * dpr);
      cv.style.width = `${vp.width}px`; cv.style.height = `${vp.height}px`;
      const ctx = cv.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      await p.render({ canvasContext: ctx, viewport: vp }).promise;
      if (cancelado) return;
      setEscala(esc);
      if (posicao && posicao.pagina === pagina) {
        const [vx, vy] = vp.convertToViewportPoint(posicao.x, posicao.y + SELO.h);
        setMarca({ left: vx, top: vy });
      } else setMarca(null);
    })();
    return () => { cancelado = true; };
  }, [pdf, pagina, posicao]);

  function clique(ev: React.MouseEvent<HTMLCanvasElement>) {
    if (!escolherPosicao || !viewport.current) return;
    const r = ev.currentTarget.getBoundingClientRect();
    const cx = ev.clientX - r.left, cy = ev.clientY - r.top;
    const [x, y] = viewport.current.convertToPdfPoint(cx, cy); // ponto clicado = centro do selo
    aoEscolher({ pagina, x: x - SELO.w / 2, y: y - SELO.h / 2 });
  }

  return (
    <div ref={caixa} className="flex min-h-full flex-col items-center gap-3 p-4">
      <div className="flex w-full max-w-[900px] flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2">
          <button type="button" className="botao-sec h-8 px-2.5" disabled={!pdf || pagina === 0} onClick={() => setPagina((p) => p - 1)}>‹</button>
          <span className="text-slate-700">Página {pagina + 1} de {pdf?.numPages ?? "…"}</span>
          <button type="button" className="botao-sec h-8 px-2.5" disabled={!pdf || pagina + 1 >= (pdf?.numPages ?? 1)} onClick={() => setPagina((p) => p + 1)}>›</button>
        </div>
        <div className="flex items-center gap-3">
          {escolherPosicao && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Clique onde a assinatura deve ficar</span>}
          <a href={`/api/documentos/${documentoId}`} target="_blank" rel="noopener" className="text-xs font-medium text-marinha hover:underline">Abrir em nova aba</a>
          <a href={`/api/documentos/${documentoId}?baixar=1`} className="text-xs font-medium text-marinha hover:underline">Baixar</a>
        </div>
      </div>
      {erro ? <p className="text-sm text-red-700">{erro}</p> : (
        <div className="relative shadow-lg">
          <canvas ref={canvas} onClick={clique} className={`block bg-white ${escolherPosicao ? "cursor-crosshair" : ""}`} />
          {marca && (
            <div className="pointer-events-none absolute border-2 border-dashed border-marinha bg-blue-100/40 text-[10px] font-semibold text-marinha"
              style={{ left: marca.left, top: marca.top, width: SELO.w * escala, height: SELO.h * escala }}>
              <span className="m-1 inline-block">Sua assinatura aqui</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
