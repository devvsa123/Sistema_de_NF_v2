"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { acaoTramitar } from "@/app/acoes/notas";
import { linkNota } from "@/lib/format";
import type { Acao } from "@/lib/fluxo";
import { ComentariosNota } from "./ComentariosNota";
import { CampoIdPa } from "./CampoIdPa";
import { ItensRapidos } from "./ItensRapidos";

export type LinhaFila = {
  id: number; numero: string; empresa: string; valor: string; oc: string; dias: string; farol: "verde" | "amarelo" | "vermelho" | null;
  obs: string; comentarios: number; docs: number; docsFaltando: string; sobMedida: boolean; idPa: string; editaIdPa: boolean; exigeIdPa: boolean; obsOc: string; arrecadada: boolean; recebida: string; total: string; situacao?: string;
};
export type BotaoFila = { acao: Acao; rotulo: string; estilo?: "principal" | "sec" | "perigo" };

const COR = { verde: "bg-emerald-500", amarelo: "bg-amber-400", vermelho: "bg-red-500" };

export function FilaTabela({ linhas, botoes, mostrarArrecadacao, laudo = false, docsRecebimento = false, volta }: { linhas: LinhaFila[]; botoes: BotaoFila[]; mostrarArrecadacao: boolean; laudo?: boolean; docsRecebimento?: boolean; volta?: string }) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [filtro, setFiltro] = useState("");
  const [obs, setObs] = useState("");
  const [reprovando, setReprovando] = useState(false);
  const [visual, setVisual] = useState("");
  const [lab, setLab] = useState("");
  const [retorno, setRetorno] = useState<{ feitas: number; erros: string[] } | null>(null);
  const [pendente, iniciar] = useTransition();

  const visiveis = useMemo(() => {
    const t = filtro.trim().toLowerCase();
    return t ? linhas.filter((l) => `${l.numero} ${l.empresa} ${l.oc}`.toLowerCase().includes(t)) : linhas;
  }, [linhas, filtro]);
  const todasMarcadas = visiveis.length > 0 && visiveis.every((l) => sel.has(l.id));

  function alternar(id: number) {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function executar(acao: Acao) {
    const ids = linhas.filter((l) => sel.has(l.id)).map((l) => l.id);
    if (!ids.length) return;
    if (acao === "reprovar" && !reprovando) return setReprovando(true);
    iniciar(async () => {
      const r = await acaoTramitar(ids, acao, { obs, visual, laboratorial: lab });
      setRetorno(r);
      if (r.feitas) {
        setSel(new Set());
        setObs("");
        setReprovando(false);
        setVisual("");
        setLab("");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="cartao overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-3 py-2">
          <input className="campo max-w-xs" placeholder="Filtrar por número, empresa ou OC…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          <span className="text-sm text-slate-500">{sel.size ? `${sel.size} selecionada(s)` : `${visiveis.length} nota(s)`}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr>
                <th className="w-8">
                  <input
                    type="checkbox" aria-label="Selecionar todas" checked={todasMarcadas}
                    onChange={() => setSel(todasMarcadas ? new Set() : new Set(visiveis.map((l) => l.id)))}
                  />
                </th>
                <th>NF</th><th>Empresa</th><th className="text-right">Valor</th><th>OC</th><th>ID de PA</th><th title="A fila segue a ordem de chegada da NF ao depósito">Chegada</th><th>Na etapa há</th><th>Observações</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => (
                <tr key={l.id} className={sel.has(l.id) ? "!bg-blue-50" : l.sobMedida ? "bg-violet-50/70 shadow-[inset_3px_0_0_#7c3aed]" : ""}>
                  <td><input type="checkbox" aria-label={`Selecionar NF ${l.numero}`} checked={sel.has(l.id)} onChange={() => alternar(l.id)} /></td>
                  <td className="whitespace-nowrap">
                    <Link href={linkNota(l.id, volta)} className="font-semibold text-marinha hover:underline">{l.numero}</Link>
                    {l.sobMedida && <span title="Material sob medida" className="ml-2 rounded bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Sob medida</span>}
                    <ItensRapidos id={l.id} numero={l.numero} volta={volta} />
                    <Link href={`${linkNota(l.id, volta)}#documentos`} title={l.docsFaltando ? `Falta anexar: ${l.docsFaltando}` : `${l.docs} documento(s) anexado(s)`}
                      className={`ml-2 rounded border px-1.5 py-0.5 text-[11px] font-medium ${l.docsFaltando ? "border-red-300 bg-red-50 text-red-700 hover:border-red-500" : "border-slate-200 text-slate-600 hover:border-marinha hover:text-marinha"}`}>
                      Docs{l.docs ? ` (${l.docs})` : ""}{l.docsFaltando ? " !" : ""}
                    </Link>
                    {docsRecebimento && <Link href={`/notas/${l.id}/recebimento${volta ? `?volta=${encodeURIComponent(volta)}` : ""}`} className="ml-2 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:border-marinha hover:text-marinha">TAV / Check-list</Link>}
                    {laudo && <Link href={`/notas/${l.id}/laudo${volta ? `?volta=${encodeURIComponent(volta)}` : ""}`} className="ml-2 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:border-marinha hover:text-marinha">Laudo</Link>}
                    {l.situacao && <span className="block text-xs text-slate-500">{l.situacao}</span>}
                    {mostrarArrecadacao && (
                      <span className={`block text-xs ${l.arrecadada ? "text-emerald-700" : "text-amber-700"}`}>{l.arrecadada ? "Arrecadada" : "Não arrecadada"}</span>
                    )}
                  </td>
                  <td className="max-w-56">{l.empresa}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{l.valor}</td>
                  <td className="whitespace-nowrap">{l.oc}</td>
                  <td className="whitespace-nowrap"><CampoIdPa id={l.id} numero={l.numero} valor={l.idPa} editavel={l.editaIdPa} exigido={l.exigeIdPa} /></td>
                  <td className="whitespace-nowrap">
                    {l.recebida}
                    <span className="block text-xs text-slate-500">{l.total} no total</span>
                  </td>
                  <td className="whitespace-nowrap">
                    {l.farol && <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${COR[l.farol]}`} />}
                    {l.dias}
                  </td>
                  <td className="max-w-md text-xs text-slate-600">
                    {l.obs && <span className="line-clamp-2" title={l.obs}>{l.obs}</span>}
                    {l.obsOc && <span className="block text-slate-400">OC: {l.obsOc}</span>}
                    <span className={l.obs || l.obsOc ? "mt-1.5 block" : "block"}><ComentariosNota id={l.id} numero={l.numero} total={l.comentarios} /></span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="cartao sticky bottom-3 space-y-3 p-3">
        {reprovando && (
          <div className="grid gap-3 rounded-lg bg-red-50 p-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="rotulo">Reprovada na perícia visual?</span>
              <select className="campo" value={visual} onChange={(e) => setVisual(e.target.value)}>
                <option value="">Selecione…</option><option>Sim</option><option>Não</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="rotulo">Reprovada na perícia laboratorial?</span>
              <select className="campo" value={lab} onChange={(e) => setLab(e.target.value)}>
                <option value="">Selecione…</option><option>Sim</option><option>Não</option><option>Não ocorreu</option>
              </select>
            </label>
            <p className="text-xs text-red-700 sm:col-span-2">Descreva o motivo da reprovação no campo de observação abaixo e confirme.</p>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-64 flex-1">
            <span className="rotulo">Observação {reprovando ? "(obrigatória)" : "(opcional)"}</span>
            <input className="campo" value={obs} maxLength={2000} onChange={(e) => setObs(e.target.value)} placeholder="Será registrada no histórico das NF selecionadas" />
          </label>
          {reprovando ? (
            <>
              <button className="botao-sec" onClick={() => setReprovando(false)} disabled={pendente}>Cancelar</button>
              <button className="botao !bg-red-600 hover:!bg-red-700" onClick={() => executar("reprovar")} disabled={pendente || !sel.size || !obs.trim() || !visual || !lab}>
                Confirmar reprovação
              </button>
            </>
          ) : (
            botoes.map((b) => (
              <button
                key={b.acao}
                className={b.estilo === "perigo" ? "botao-perigo" : b.estilo === "sec" ? "botao-sec" : "botao"}
                onClick={() => executar(b.acao)}
                disabled={pendente || !sel.size}
              >
                {pendente ? "Aguarde…" : b.rotulo}
              </button>
            ))
          )}
        </div>
        {retorno && (
          <div className="text-sm" role="status">
            {retorno.feitas > 0 && <p className="text-emerald-700">{retorno.feitas} NF atualizada(s) com sucesso.</p>}
            {retorno.erros.map((e, i) => <p key={i} className="text-red-700">{e}</p>)}
          </div>
        )}
      </div>
    </div>
  );
}
