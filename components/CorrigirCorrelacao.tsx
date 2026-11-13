"use client";

import { useState, useTransition } from "react";
import { FormAcao } from "./FormAcao";
import { acaoBuscarNoEstoque, acaoConfirmarCorrelacao, acaoDesfazerCorrelacao } from "@/app/acoes/estoque";

type Opcao = { pi: string; descricao: string; cxp: number | null };

/** Escolher o item do estoque para um item da NF (entre as sugestões ou pesquisando no catálogo). */
export function CorrigirCorrelacao({ id, refItem, candidatos, confirmada, rotulo }: { id: number; refItem: string; candidatos: Opcao[]; confirmada: boolean; rotulo: string }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<Opcao[]>([]);
  const [pendente, iniciar] = useTransition();
  const opcoes = [...candidatos, ...achados.filter((a) => !candidatos.some((c) => c.pi === a.pi))];

  if (!aberto)
    return (
      <button type="button" onClick={() => setAberto(true)} className="text-xs font-semibold text-marinha hover:underline">
        {rotulo}
      </button>
    );
  return (
    <div className="mt-2 w-80 max-w-full space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm">
      <div className="flex gap-1.5">
        <input className="campo h-8 text-xs" placeholder="Pesquisar no estoque (descrição ou PI)" value={busca} onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); iniciar(async () => setAchados(await acaoBuscarNoEstoque(busca))); } }} />
        <button type="button" className="botao-sec h-8 px-2 text-xs" disabled={pendente || !busca.trim()} onClick={() => iniciar(async () => setAchados(await acaoBuscarNoEstoque(busca)))}>
          {pendente ? "…" : "Buscar"}
        </button>
      </div>
      <FormAcao acao={acaoConfirmarCorrelacao} botao="Confirmar" className="space-y-2" classeBotao="botao h-8 px-3 text-xs">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="ref" value={refItem} />
        <div className="max-h-52 space-y-1 overflow-y-auto">
          {opcoes.length === 0 && <p className="text-xs text-slate-500">Nenhuma sugestão. Pesquise acima ou digite o PI.</p>}
          {opcoes.map((o) => (
            <label key={o.pi} className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-xs hover:bg-slate-50">
              <input type="radio" name="pi" value={o.pi} className="mt-0.5" />
              <span><span className="font-mono text-slate-500">{o.pi}</span> {o.descricao} <span className="text-slate-400">· CXP {o.cxp ?? "—"}</span></span>
            </label>
          ))}
        </div>
        <input name="pi_digitado" className="campo h-8 font-mono text-xs" placeholder="ou digite o PI (ex.: 190012703)" maxLength={20} />
      </FormAcao>
      <div className="flex justify-between">
        <button type="button" onClick={() => setAberto(false)} className="text-xs text-slate-500 hover:underline">Fechar</button>
        {confirmada && (
          <FormAcao acao={acaoDesfazerCorrelacao} botao="Desfazer correlação confirmada" classeBotao="text-xs text-red-600 hover:underline cursor-pointer">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="ref" value={refItem} />
          </FormAcao>
        )}
      </div>
    </div>
  );
}
