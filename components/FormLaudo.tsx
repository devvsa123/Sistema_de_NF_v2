"use client";

import { useState } from "react";
import { FormAcao } from "./FormAcao";
import { acaoEmitirLaudo } from "@/app/acoes/laudo";
import type { DadosLaudo } from "@/lib/laudo";

const VISUAL = ["Aprovado", "Aceitável", "Reprovado"];
const LAB = ["Aprovado", "Aceitável", "Reprovado", "Não se aplica"];

function Opcoes({ nome, opcoes, valor, onChange }: { nome: string; opcoes: string[]; valor: string; onChange?: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {opcoes.map((o) => (
        <label key={o} className="cursor-pointer">
          <input type="radio" name={nome} value={o} defaultChecked={valor === o} onChange={() => onChange?.(o)} className="peer sr-only" required />
          <span className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition peer-checked:border-marinha peer-checked:bg-marinha peer-checked:text-white peer-focus-visible:ring-4 peer-focus-visible:ring-marinha/20">
            {o}
          </span>
        </label>
      ))}
    </div>
  );
}

function Contador({ nome, rotulo, inicial }: { nome: string; rotulo: string; inicial: string }) {
  const [n, setN] = useState(inicial.length);
  return (
    <label className="block">
      <span className="rotulo flex justify-between">{rotulo}<span className={n > 300 ? "text-red-600" : "text-slate-400"}>{n}/300</span></span>
      <textarea name={nome} defaultValue={inicial} maxLength={300} rows={3} className="campo" onChange={(e) => setN(e.target.value.length)} />
    </label>
  );
}

export function FormLaudo({ id, inicial }: { id: number; inicial: Partial<DadosLaudo> }) {
  const [medidas, setMedidas] = useState(inicial.medidas ?? "Sim");
  const [lab, setLab] = useState(inicial.resultado_laboratorial ?? "");
  const semLab = lab === "Não se aplica";
  return (
    <FormAcao acao={acaoEmitirLaudo} botao="Emitir laudo e baixar" className="space-y-5">
      <input type="hidden" name="id" value={id} />
      <section className="cartao space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-slate-900">Identificação</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <label><span className="rotulo">Número do protocolo *</span><input name="protocolo" defaultValue={inicial.protocolo} className="campo" required maxLength={60} /></label>
          <label><span className="rotulo">Lote</span><input name="lote" defaultValue={inicial.lote} className="campo" maxLength={60} /></label>
          <label><span className="rotulo">Fabricação</span><input name="fabricacao" defaultValue={inicial.fabricacao} className="campo" maxLength={60} placeholder="mês/ano" /></label>
        </div>
      </section>

      <section className="cartao space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-slate-900">Perícia visual</h2>
        <div><span className="rotulo">Resultado *</span><Opcoes nome="resultado_visual" opcoes={VISUAL} valor={inicial.resultado_visual ?? ""} /></div>
        <div>
          <span className="rotulo">Foram aferidas todas as medidas comuns e básicas, de acordo com a especificação? *</span>
          <Opcoes nome="medidas" opcoes={["Sim", "Não"]} valor={medidas} onChange={setMedidas} />
        </div>
        {medidas === "Não" && (
          <label className="block"><span className="rotulo">Explicação (obrigatória quando “Não”)</span>
            <input name="medidas_explicacao" defaultValue={inicial.medidas_explicacao} className="campo" maxLength={200} required /></label>
        )}
        <Contador nome="obs_visual" rotulo="Observações da perícia visual" inicial={inicial.obs_visual ?? ""} />
      </section>

      <section className="cartao space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-slate-900">Perícia laboratorial</h2>
        <div><span className="rotulo">Resultado *</span><Opcoes nome="resultado_laboratorial" opcoes={LAB} valor={lab} onChange={setLab} /></div>
        {!semLab && (
          <div className="grid gap-4 sm:grid-cols-3">
            <label><span className="rotulo">Número do ofício ao SENAI</span><input name="numero_oficio" defaultValue={inicial.numero_oficio} className="campo" maxLength={60} /></label>
            <label><span className="rotulo">Enviado ao laboratório em</span><input type="date" name="data_envio" defaultValue={inicial.data_envio} className="campo" /></label>
            <label><span className="rotulo">Recebido do laboratório em</span><input type="date" name="data_recebimento" defaultValue={inicial.data_recebimento} className="campo" /></label>
          </div>
        )}
        {semLab && <p className="text-sm text-slate-500">Ofício e datas do laboratório sairão como “Não se aplica”.</p>}
        <Contador nome="obs_laboratorial" rotulo="Observações da perícia laboratorial" inicial={inicial.obs_laboratorial ?? ""} />
      </section>
      <p className="text-xs text-slate-500">Campos em branco saem como “Não se aplica” (ofício e datas) ou vazios. O laudo fica registrado no histórico da NF e pode ser baixado de novo depois.</p>
    </FormAcao>
  );
}
