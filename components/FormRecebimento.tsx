"use client";

import { FormAcao } from "./FormAcao";
import { acaoEmitirRecebimento } from "@/app/acoes/recebimento";
import type { DadosRecebimento } from "@/lib/recebimento";

function Opcoes({ nome, opcoes, valor }: { nome: string; opcoes: string[]; valor?: string }) {
  return (
    <div className="flex shrink-0 gap-1.5">
      {opcoes.map((o) => (
        <label key={o} className="cursor-pointer">
          <input type="radio" name={nome} value={o} defaultChecked={valor === o} className="peer sr-only" required />
          <span className="inline-flex h-8 min-w-14 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition peer-checked:border-marinha peer-checked:bg-marinha peer-checked:text-white peer-focus-visible:ring-4 peer-focus-visible:ring-marinha/20">
            {o}
          </span>
        </label>
      ))}
    </div>
  );
}

export function FormRecebimento({ id, inicial, perguntas }: { id: number; inicial: DadosRecebimento; perguntas: string[] }) {
  return (
    <FormAcao acao={acaoEmitirRecebimento} botao="Emitir TAV e Check-list" className="space-y-5">
      <input type="hidden" name="id" value={id} />
      <section className="cartao space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-slate-900">Identificação</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <label><span className="rotulo">Nº do TAV *</span><input name="numero_tav" defaultValue={inicial.numero_tav} className="campo" required inputMode="numeric" maxLength={6} /></label>
          <label><span className="rotulo">Data do recebimento *</span><input type="date" name="data_recebimento" defaultValue={inicial.data_recebimento} className="campo" required /></label>
          <label><span className="rotulo">ID do PA</span><input name="id_pa" defaultValue={inicial.id_pa} className="campo" maxLength={30} /></label>
          <label><span className="rotulo">Lote</span><input name="lote" defaultValue={inicial.lote} className="campo" maxLength={60} /></label>
          <label><span className="rotulo">Fabricação</span><input name="fabricacao" defaultValue={inicial.fabricacao} className="campo" maxLength={30} placeholder="mês/ano" /></label>
          <label><span className="rotulo">Volumes</span><input name="volumes" defaultValue={inicial.volumes} className="campo" maxLength={60} placeholder="ex.: 40 caixas" /></label>
        </div>
      </section>

      <section className="cartao space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-slate-900">TAV — Termo de Abertura de Volumes</h2>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <span className="text-sm text-slate-700">Conferência feita por *</span>
          <Opcoes nome="conferencia" opcoes={["Contagem manual", "Pesagem"]} valor={inicial.conferencia} />
        </div>
        <ol className="divide-y divide-slate-100">
          {perguntas.map((p, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <span className="text-sm text-slate-700">{i + 1}. {p} *</span>
              <Opcoes nome={`q${i + 1}`} opcoes={["Sim", "Não"]} valor={inicial.respostas[i]} />
            </li>
          ))}
        </ol>
        <p className="text-xs text-slate-500">Caso confirmada discrepância em algum item acima, relate na observação.</p>
        <label className="block"><span className="rotulo">Observação do TAV</span>
          <textarea name="observacao" defaultValue={inicial.observacao} rows={3} maxLength={600} className="campo" /></label>
      </section>

      <section className="cartao space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-slate-900">Check-list de Recebimento</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <label><span className="rotulo">1. Peso de um volume (kg)</span><input name="peso_kg" defaultValue={inicial.peso_kg} className="campo" inputMode="decimal" maxLength={20} /></label>
          <label><span className="rotulo">Itens por caixa</span><input name="itens_caixa" defaultValue={inicial.itens_caixa} className="campo" inputMode="numeric" maxLength={20} /></label>
          <label><span className="rotulo">2. Envio da amostra à Divisão Técnica</span><input type="date" name="data_envio_amostra" defaultValue={inicial.data_envio_amostra} className="campo" /></label>
        </div>
        <label className="block"><span className="rotulo">Observação (item 2)</span>
          <textarea name="obs_recebimento" defaultValue={inicial.obs_recebimento} rows={2} maxLength={300} className="campo" /></label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-slate-700">4. Discrepâncias na contagem? *</span>
          <Opcoes nome="discrepancia" opcoes={["Sim", "Não"]} valor={inicial.discrepancia} />
        </div>
        <label className="block"><span className="rotulo">Observação da contagem (item 4)</span>
          <textarea name="obs_contagem" defaultValue={inicial.obs_contagem} rows={3} maxLength={900} className="campo" /></label>
      </section>
      <p className="text-xs text-slate-500">Os dois documentos saem preenchidos com os dados da NF (número, OC e empresa). Ficam registrados no histórico da NF e podem ser baixados de novo.</p>
    </FormAcao>
  );
}
