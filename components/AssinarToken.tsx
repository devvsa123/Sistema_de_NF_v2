"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { comando, conectar, TUTORIAL_AUTORIZAR, TUTORIAL_INSTALAR } from "./serpro-cliente";
import { useRouter } from "next/navigation";
import { acaoCamposAssinatura, acaoConcluirAssinatura, acaoIdentificarCertificado, acaoPrepararAssinatura } from "@/app/acoes/assinador";

/**
 * "Assinar com token": o navegador conversa com o Assinador SERPRO instalado no computador
 * (wss://127.0.0.1:65156/signer/), que pede o certificado e o PIN e assina o resumo do documento.
 */

type Campo = { nome: string; rotulo: string; assinado: boolean };
type Etapa = "conectando" | "sem-assinador" | "escolher" | "assinando" | "concluido" | "erro";

export function AssinarToken({ registroId, doc, rotulo = "Assinar com token", compacto = false }: { registroId: number; doc: "tav" | "checklist"; rotulo?: string; compacto?: boolean }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAberto(true)} className={compacto ? "font-medium text-marinha hover:underline" : "botao"}>{rotulo}</button>
      {aberto && <Janela registroId={registroId} doc={doc} fechar={() => setAberto(false)} />}
    </>
  );
}

function Janela({ registroId, doc, fechar }: { registroId: number; doc: "tav" | "checklist"; fechar: () => void }) {
  const [etapa, setEtapa] = useState<Etapa>("conectando");
  const [campos, setCampos] = useState<Campo[]>([]);
  const [campo, setCampo] = useState("");
  const [msg, setMsg] = useState("");
  const [diag, setDiag] = useState("");
  const ws = useRef<WebSocket | null>(null);
  const router = useRouter();
  const nomeDoc = doc === "tav" ? "TAV" : "Check-list";

  const iniciar = useCallback(async () => {
    setEtapa("conectando"); setMsg("");
    try {
      ws.current?.close();
      ws.current = await conectar(setDiag);
    } catch {
      setEtapa("sem-assinador");
      return;
    }
    const r = await acaoCamposAssinatura(registroId, doc);
    if (r.erro) { setEtapa("erro"); setMsg(r.erro); return; }
    setCampos(r.campos);
    const livre = r.campos.find((c) => !c.assinado);
    setCampo(livre?.nome ?? "");
    setEtapa("escolher");
  }, [registroId, doc]);

  useEffect(() => {
    const t = setTimeout(iniciar, 0);
    return () => { clearTimeout(t); ws.current?.close(); };
  }, [iniciar]);

  /** Pede ao Assinador para assinar um resumo; devolve a assinatura, ou null se a pessoa cancelou. */
  async function assinarResumo(resumo: string): Promise<string | null> {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) ws.current = await conectar();
    const r = await comando(ws.current, { command: "sign", type: "hash", inputData: resumo });
    if (r.actionCanceled) return null;
    if (r.error || !r.signature) throw new Error(`O Assinador SERPRO informou: ${String(r.error ?? "sem assinatura")}`);
    return String(r.signature);
  }

  async function assinar() {
    if (!campo || !ws.current) return;
    setEtapa("assinando"); setMsg("");
    try {
      for (let tentativa = 0; tentativa < 3; tentativa++) {
        let p = await acaoPrepararAssinatura(registroId, doc, campo);
        if ("identificar" in p) {
          // primeira assinatura desta pessoa pelo sistema: identifica o certificado (nome completo e CPF para o selo)
          setMsg("Primeira assinatura pelo sistema: o Assinador vai pedir o PIN uma vez para identificar o seu certificado, e depois outra para assinar.");
          const aleatorio = new Uint8Array(32);
          crypto.getRandomValues(aleatorio);
          const resumoTeste = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", aleatorio))));
          const sigTeste = await assinarResumo(resumoTeste);
          if (!sigTeste) { setEtapa("escolher"); setMsg("Assinatura cancelada no Assinador."); return; }
          const idt = await acaoIdentificarCertificado(sigTeste);
          if ("erro" in idt && idt.erro) throw new Error(idt.erro);
          p = await acaoPrepararAssinatura(registroId, doc, campo);
        }
        if ("erro" in p && p.erro) throw new Error(p.erro);
        if ("identificar" in p) throw new Error("Não foi possível identificar o certificado.");
        const { id, resumo } = p as { id: number; resumo: string };
        const assinatura = await assinarResumo(resumo);
        if (!assinatura) { setEtapa("escolher"); setMsg("Assinatura cancelada no Assinador."); return; }
        const c = await acaoConcluirAssinatura(id, assinatura);
        if ("refazer" in c && c.refazer) {
          setMsg("O certificado usado é diferente do anterior: o selo foi atualizado. Confirme o PIN mais uma vez.");
          continue;
        }
        if (c.erro) throw new Error(c.erro);
        setEtapa("concluido"); setMsg(c.ok ?? "");
        router.refresh();
        return;
      }
      throw new Error("Não foi possível concluir a assinatura.");
    } catch (e) {
      setEtapa("erro"); setMsg(e instanceof Error ? e.message : "Falha ao falar com o Assinador SERPRO.");
    }
  }

  const todos = campos.length > 0 && campos.every((c) => c.assinado);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onClick={fechar} role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="assinar-titulo" onClick={(e) => e.stopPropagation()} className="w-full max-w-lg overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id="assinar-titulo" className="text-[15px] font-semibold text-slate-900">Assinar o {nomeDoc} com o token</h2>
            <p className="text-xs text-slate-500">Pelo Assinador SERPRO instalado neste computador.</p>
          </div>
          <button type="button" onClick={fechar} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Fechar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" className="h-5 w-5" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="space-y-3 px-5 py-4 text-sm">
          {etapa === "conectando" && <p className="text-slate-600">Procurando o Assinador SERPRO neste computador…</p>}

          {etapa === "sem-assinador" && (
            <div className="space-y-2 text-slate-700">
              <p className="font-medium text-red-700">Não foi possível falar com o Assinador SERPRO.</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>Confira se o <strong>Assinador SERPRO</strong> está instalado e aberto (ícone perto do relógio do Windows). <a href={TUTORIAL_INSTALAR} target="_blank" rel="noopener" className="text-marinha underline">Como instalar</a>.</li>
                <li>Se o navegador perguntar sobre <strong>acesso à rede local</strong>, clique em <strong>Permitir</strong>.</li>
                <li>Na primeira vez, autorize o navegador: <a href={TUTORIAL_AUTORIZAR} target="_blank" rel="noopener" className="text-marinha underline">passo a passo do SERPRO</a>.</li>
              </ol>
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                No <strong>Firefox</strong> (ou na primeira vez em qualquer navegador): abra <a href="https://127.0.0.1:65156/" target="_blank" rel="noopener" className="text-marinha underline">127.0.0.1:65156</a> em uma nova aba. Se aparecer aviso de certificado, clique em <strong>Avançado → Aceitar o risco e continuar</strong> (é o próprio Assinador, no seu computador). Quando aparecer “O procedimento foi realizado com sucesso”, feche a aba e clique em Tentar de novo.
                {diag && <span className="mt-1 block font-mono text-[11px] text-slate-500">Detalhe: {diag}</span>}
              </p>
              <button type="button" className="botao" onClick={iniciar}>Tentar de novo</button>
            </div>
          )}

          {(etapa === "escolher" || etapa === "assinando") && (
            todos ? <p className="text-emerald-700">Todos os campos deste documento já estão assinados.</p> : (
              <>
                <p className="text-slate-700">Escolha o campo da sua assinatura:</p>
                <div className="space-y-1.5">
                  {campos.map((c) => (
                    <label key={c.nome} className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${c.assinado ? "border-emerald-200 bg-emerald-50 text-emerald-800" : campo === c.nome ? "border-marinha bg-blue-50" : "border-slate-200"}`}>
                      <input type="radio" name="campo" value={c.nome} checked={campo === c.nome} disabled={c.assinado || etapa === "assinando"} onChange={() => setCampo(c.nome)} />
                      <span className="flex-1">{c.rotulo}</span>
                      {c.assinado && <span className="text-xs font-medium">✔ já assinado</span>}
                    </label>
                  ))}
                </div>
                {msg && etapa !== "assinando" && <p className="text-amber-700">{msg}</p>}
                {etapa === "assinando"
                  ? <p className="rounded-lg bg-blue-50 px-3 py-2 text-blue-900">{msg && <span className="mb-1 block font-medium">{msg}</span>}Confirme no <strong>Assinador SERPRO</strong>: escolha o certificado do token e digite o PIN. A janela dele pode abrir atrás do navegador.</p>
                  : <button type="button" className="botao" disabled={!campo} onClick={assinar}>Assinar com o token</button>}
              </>
            )
          )}

          {etapa === "concluido" && (
            <div className="space-y-2">
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">✔ {msg} O documento assinado já está em Documentos da NF.</p>
              <button type="button" className="botao-sec" onClick={fechar}>Fechar</button>
            </div>
          )}

          {etapa === "erro" && (
            <div className="space-y-2">
              <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{msg}</p>
              <button type="button" className="botao-sec" onClick={iniciar}>Tentar de novo</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
