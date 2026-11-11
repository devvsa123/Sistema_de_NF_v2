"use client";

import { useState, useTransition } from "react";
import { acaoTramitar } from "@/app/acoes/notas";
import type { BotaoFila } from "./FilaTabela";
import type { Acao } from "@/lib/fluxo";

/** Botões de tramitação na tela de detalhe de uma NF. */
export function AcoesNota({ id, botoes }: { id: number; botoes: BotaoFila[] }) {
  const [obs, setObs] = useState("");
  const [reprovando, setReprovando] = useState(false);
  const [visual, setVisual] = useState("");
  const [lab, setLab] = useState("");
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();

  function executar(acao: Acao) {
    if (acao === "reprovar" && !reprovando) return setReprovando(true);
    setErro("");
    iniciar(async () => {
      const r = await acaoTramitar([id], acao, { obs, visual, laboratorial: lab });
      if (r.erros.length) setErro(r.erros.join(" "));
      else {
        setObs("");
        setReprovando(false);
      }
    });
  }

  return (
    <div className="space-y-3">
      {reprovando && (
        <div className="grid gap-3 rounded-lg bg-red-50 p-3 sm:grid-cols-2">
          <label>
            <span className="rotulo">Reprovada na perícia visual?</span>
            <select className="campo" value={visual} onChange={(e) => setVisual(e.target.value)}>
              <option value="">Selecione…</option><option>Sim</option><option>Não</option>
            </select>
          </label>
          <label>
            <span className="rotulo">Reprovada na perícia laboratorial?</span>
            <select className="campo" value={lab} onChange={(e) => setLab(e.target.value)}>
              <option value="">Selecione…</option><option>Sim</option><option>Não</option><option>Não ocorreu</option>
            </select>
          </label>
        </div>
      )}
      <label className="block">
        <span className="rotulo">{reprovando ? "Motivo da reprovação (obrigatório)" : "Observação (opcional)"}</span>
        <input className="campo" value={obs} maxLength={2000} onChange={(e) => setObs(e.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        {reprovando ? (
          <>
            <button className="botao-sec" onClick={() => setReprovando(false)} disabled={pendente}>Cancelar</button>
            <button className="botao !bg-red-600 hover:!bg-red-700" onClick={() => executar("reprovar")} disabled={pendente || !obs.trim() || !visual || !lab}>
              Confirmar reprovação
            </button>
          </>
        ) : (
          botoes.map((b) => (
            <button key={b.acao} disabled={pendente} onClick={() => executar(b.acao)}
              className={b.estilo === "perigo" ? "botao-perigo" : b.estilo === "sec" ? "botao-sec" : "botao"}>
              {pendente ? "Aguarde…" : b.rotulo}
            </button>
          ))
        )}
      </div>
      {erro && <p role="alert" className="text-sm text-red-700">{erro}</p>}
    </div>
  );
}
