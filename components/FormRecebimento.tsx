"use client";

import { useState } from "react";
import { FormAcao } from "./FormAcao";
import { CorrigirCorrelacao } from "./CorrigirCorrelacao";
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

export type VolumeEsperado = { ref: string; n: number; item: string; esperado: number | null };

/** Volumes recebidos de cada item, quando a pergunta 1 do TAV ("volumes em conformidade") é Não. */
function VolumesRecebidos({ linhas, inicial }: { linhas: VolumeEsperado[]; inicial: Record<string, number> }) {
  const [valores, setValores] = useState<Record<string, string>>(Object.fromEntries(linhas.map((l) => [l.ref, inicial[l.ref] !== undefined ? String(inicial[l.ref]) : ""])));
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3">
      <p className="text-sm font-semibold text-amber-900">Volumes recebidos de cada item</p>
      <p className="mb-2 text-xs text-amber-900/80">Informe quantos volumes (caixas) chegaram. Recebido a menor, a NF fica marcada como <strong>NF Parcial</strong>. Descreva a discrepância na observação (obrigatória).</p>
      <table className="w-full text-left text-sm">
        <thead><tr className="text-[11px] font-semibold uppercase tracking-wide text-slate-500"><th className="pb-1 pr-2">#</th><th className="pb-1 pr-2">Item</th><th className="pb-1 pr-2 text-right">Esperado</th><th className="pb-1 pr-2">Recebidos *</th><th className="pb-1">Diferença</th></tr></thead>
        <tbody className="divide-y divide-amber-200/70">
          {linhas.map((l) => {
            const v = valores[l.ref] ?? "";
            const n = v.trim() === "" ? null : Number(v.replace(/\./g, "").replace(",", "."));
            const dif = n !== null && Number.isFinite(n) && l.esperado !== null ? n - l.esperado : null;
            return (
              <tr key={l.ref}>
                <td className="py-1.5 pr-2 text-xs text-slate-500">{l.ref === "total" ? "—" : l.n}<input type="hidden" name="volref" value={l.ref} /></td>
                <td className="py-1.5 pr-2 text-slate-800">{l.item}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600">{l.esperado ?? "—"}</td>
                <td className="py-1.5 pr-2"><input name={`vol_${l.ref}`} value={v} onChange={(e) => setValores((x) => ({ ...x, [l.ref]: e.target.value }))} required inputMode="numeric" maxLength={8}
                  className="campo h-8 w-24 text-right tabular-nums" aria-label={`Volumes recebidos ${l.ref === "total" ? "(total)" : `do item ${l.n}`}`} /></td>
                <td className="py-1.5 text-xs">{dif === null ? <span className="text-slate-400">—</span> : dif === 0 ? <span className="text-emerald-700">✔ confere</span>
                  : <span className={`font-semibold ${dif < 0 ? "text-red-700" : "text-amber-800"}`}>{dif > 0 ? `+${dif} a maior` : `${dif} a menor`}</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function FormTav({ id, inicial, perguntas, numeroTav, reemissao, volumes = [] }: { id: number; inicial: DadosRecebimento; perguntas: string[]; numeroTav: string; reemissao: boolean; volumes?: VolumeEsperado[] }) {
  const [q1, setQ1] = useState(inicial.respostas[0] ?? "");
  const recebidosAntes = Object.fromEntries((inicial.volumes_recebidos ?? []).map((v) => [v.ref, v.recebidos]));
  return (
    <FormAcao acao={acaoEmitirRecebimento} botao="Emitir TAV" className="space-y-5">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="doc" value="tav" />
      <section className="cartao space-y-4 p-5">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-900">TAV — Termo de Abertura de Volumes</h2>
          <p className="mt-0.5 text-xs text-slate-500">Pré Recebimento. Sai com a relação de itens para a contagem e assinado por quem o imprime.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div><span className="rotulo">Nº do TAV</span>
            <p className="campo flex items-center bg-slate-50 font-semibold tabular-nums text-slate-900">{numeroTav}</p>
            <span className="mt-1 block text-xs text-slate-500">{reemissao ? "Reemissão: mantém o número desta NF." : "Gerado automaticamente ao emitir."}</span></div>
          <label><span className="rotulo">Data do recebimento *</span><input type="date" name="data_recebimento" defaultValue={inicial.data_recebimento} className="campo" required /><span className="mt-1 block text-xs text-slate-500">Sugerida: data em que a SECOM cadastrou a NF. Altere se o recebimento foi em outro dia.</span></label>
          <label><span className="rotulo">ID do PA *</span><input name="id_pa" defaultValue={inicial.id_pa} className="campo" maxLength={30} required pattern="[A-Za-z0-9./\-]+"
            title="Apenas letras, números, ponto, barra ou hífen" />
            <span className="mt-1 block text-xs text-slate-500">{inicial.id_pa ? "Já lançado no trâmite. Altere se precisar." : "Obrigatório para emitir o TAV."}</span></label>
        </div>
        <ol className="divide-y divide-slate-100 border-t border-slate-100" onChange={(e) => { const t = e.target as unknown as HTMLInputElement; if (t.name === "q1") setQ1(t.value); }}>
          {perguntas.map((p, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <span className="text-sm text-slate-700">{i + 1}. {p} *</span>
              <Opcoes nome={`q${i + 1}`} opcoes={["Sim", "Não"]} valor={inicial.respostas[i]} />
            </li>
          ))}
        </ol>
        {q1 === "Não" && <VolumesRecebidos linhas={volumes} inicial={recebidosAntes} />}
        <p className="text-xs text-slate-500">Caso confirmada discrepância em algum item acima, relate na observação.</p>
        <label className="block"><span className="rotulo">Observação do TAV{q1 === "Não" ? " * (obrigatória: volumes em desacordo)" : ""}</span>
          <textarea name="observacao" defaultValue={inicial.observacao} rows={3} maxLength={600} className="campo" required={q1 === "Não"} minLength={q1 === "Não" ? 3 : undefined} /></label>
      </section>
    </FormAcao>
  );
}

/** Uma linha (item da NF ou tamanho da grade) para a contagem. */
export type LinhaChecklist = {
  ref: string; n: number; descricao: string; tamanho?: string; qtd: number; un: string;
  pi: string | null; itemEstoque: string | null; pendente: boolean;
  candidatos: { pi: string; descricao: string; cxp: number | null }[]; confirmada: boolean;
};
export type ContagemAnterior = Record<string, { peso: string; discrepancia: string; diferenca: string; contada?: string }>;

const fmtQtd = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** Contagem manual: a pessoa informa quanto contou e a diferença para a NF aparece na hora. */
function LinhaContagemManual({ l, anterior }: { l: LinhaChecklist; anterior?: ContagemAnterior[string] }) {
  const [txt, setTxt] = useState(anterior?.contada ? String(anterior.contada).replace(".", ",") : "");
  const n = txt.trim() ? Number(txt.trim().replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")) : NaN;
  const dif = Number.isFinite(n) ? Math.round((n - l.qtd) * 1000) / 1000 : null;
  return (
    <tr className="align-top">
      <td className="py-2.5 pr-2 text-xs text-slate-500 tabular-nums">{l.n}{l.tamanho ? <span className="block">tam. {l.tamanho}</span> : null}
        <input type="hidden" name="ref" value={l.ref} /></td>
      <td className="py-2.5 pr-3">
        <span className="font-mono text-xs text-slate-500">{l.pi}</span>
        <span className="block text-sm text-slate-800">{l.itemEstoque ?? l.descricao}</span>
      </td>
      <td className="whitespace-nowrap py-2.5 pr-3 text-right text-sm tabular-nums text-slate-700">{fmtQtd(l.qtd)} {l.un}</td>
      <td className="py-2.5 pr-3">
        <input name={`contada_${l.ref}`} value={txt} onChange={(e) => setTxt(e.target.value)} className="campo w-28 text-right tabular-nums" inputMode="decimal" maxLength={15} required
          placeholder="contada" aria-label={`Quantidade contada do item ${l.n}`} />
      </td>
      <td className="py-2.5 text-sm">
        {dif === null ? <span className="text-slate-400">—</span>
          : dif === 0 ? <span className="font-medium text-emerald-700">✔ confere</span>
          : <span className="font-semibold text-red-700">{dif > 0 ? `+${fmtQtd(dif)} a maior` : `${fmtQtd(dif)} a menor`}</span>}
      </td>
    </tr>
  );
}

function LinhaContagem({ l, anterior }: { l: LinhaChecklist; anterior?: ContagemAnterior[string] }) {
  const [disc, setDisc] = useState(anterior?.discrepancia ?? "");
  const dif = Number(anterior?.diferenca || 0);
  const [sentido, setSentido] = useState(dif < 0 ? "menor" : "maior");
  const [qtd, setQtd] = useState(dif ? String(Math.abs(dif)).replace(".", ",") : "");
  const q = Number(qtd.replace(/\./g, "").replace(",", "."));
  const contada = disc === "Sim" && q > 0 ? l.qtd + (sentido === "menor" ? -q : q) : null;
  return (
    <tr className="align-top">
      <td className="py-2.5 pr-2 text-xs text-slate-500 tabular-nums">{l.n}{l.tamanho ? <span className="block">tam. {l.tamanho}</span> : null}
        <input type="hidden" name="ref" value={l.ref} /></td>
      <td className="py-2.5 pr-3">
        <span className="font-mono text-xs text-slate-500">{l.pi}</span>
        <span className="block text-sm text-slate-800">{l.itemEstoque ?? l.descricao}</span>
        <span className="block text-xs text-slate-500">NF: {fmtQtd(l.qtd)} {l.un}</span>
      </td>
      <td className="py-2.5 pr-3">
        <input name={`peso_${l.ref}`} defaultValue={anterior?.peso?.replace(".", ",")} className="campo w-28 tabular-nums" inputMode="decimal" maxLength={15} required placeholder="kg" aria-label={`Peso líquido do item ${l.n}`} />
      </td>
      <td className="py-2.5">
        <div className="flex gap-1.5">
          {["Não", "Sim"].map((o) => (
            <label key={o} className="cursor-pointer">
              <input type="radio" name={`disc_${l.ref}`} value={o} checked={disc === o} onChange={() => setDisc(o)} className="peer sr-only" required />
              <span className={`inline-flex h-8 min-w-12 items-center justify-center rounded-lg border px-3 text-sm font-medium transition peer-focus-visible:ring-4 peer-focus-visible:ring-marinha/20 ${disc === o ? (o === "Sim" ? "border-red-600 bg-red-600 text-white" : "border-marinha bg-marinha text-white") : "border-slate-300 bg-white text-slate-700"}`}>{o}</span>
            </label>
          ))}
        </div>
        {disc === "Sim" && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <select name={`sentido_${l.ref}`} value={sentido} onChange={(e) => setSentido(e.target.value)} className="campo h-8 w-auto py-0 text-xs" aria-label="A maior ou a menor">
              <option value="maior">A maior</option>
              <option value="menor">A menor</option>
            </select>
            <input name={`dif_${l.ref}`} value={qtd} onChange={(e) => setQtd(e.target.value)} className="campo h-8 w-20 text-xs tabular-nums" inputMode="decimal" maxLength={12} required placeholder="qtd." aria-label="Quantidade de diferença" />
            {contada !== null && <span className="text-xs text-slate-600">contado: <strong>{fmtQtd(contada)} {l.un}</strong></span>}
          </div>
        )}
      </td>
    </tr>
  );
}

export function FormChecklist({ id, inicial, tav, linhas, anterior, catalogoVazio, conferenciaInicial = "" }: {
  id: number; inicial: DadosRecebimento; tav: string | null; linhas: LinhaChecklist[]; anterior: ContagemAnterior; catalogoVazio: boolean; conferenciaInicial?: string;
}) {
  const [conferencia, setConferencia] = useState(conferenciaInicial);
  const modo = conferencia === "Contagem manual" ? "contagem" : conferencia === "Pesagem" ? "pesagem" : null;
  const titulo = <h2 className="text-[15px] font-semibold text-slate-900">Check-list da Contagem</h2>;
  if (!tav)
    return (
      <section className="cartao p-5">
        {titulo}
        <p className="mt-1 text-sm text-slate-600">Disponível depois que o TAV desta NF for emitido: o Check-list usa o número e a data do TAV.</p>
      </section>
    );
  if (catalogoVazio || !linhas.length)
    return (
      <section className="cartao p-5">
        {titulo}
        <p className="mt-1 text-sm text-red-700">{catalogoVazio ? "O catálogo do estoque não está disponível agora: sem ele não é possível listar os itens com PI para a contagem." : "Esta NF não tem itens lidos do XML para a contagem."}</p>
      </section>
    );
  const pendentes = linhas.filter((l) => l.pendente);
  if (pendentes.length)
    return (
      <section className="cartao space-y-3 p-5">
        <div>
          {titulo}
          <p className="mt-0.5 text-xs text-slate-500">Usa os dados do TAV nº {tav}.</p>
        </div>
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Confirme o PI {pendentes.length === 1 ? "deste item" : `destes ${pendentes.length} itens`}</strong> para liberar a contagem. A confirmação fica salva e vale para as próximas NF deste fornecedor.
        </p>
        <ul className="divide-y divide-slate-100">
          {pendentes.map((l) => (
            <li key={l.ref} className="py-2.5 text-sm">
              <span className="text-xs text-slate-500">Item {l.n}{l.tamanho ? ` · tam. ${l.tamanho}` : ""}</span>
              <span className="block font-medium text-slate-800">{l.descricao}</span>
              <span className="block text-xs text-slate-500">{fmtQtd(l.qtd)} {l.un} · {l.itemEstoque ? <>sugerido: <span className="font-mono">{l.pi}</span> {l.itemEstoque}</> : <span className="text-red-700">sem item correspondente no estoque</span>}</span>
              <CorrigirCorrelacao id={id} refItem={l.ref} candidatos={l.candidatos} confirmada={false} rotulo={l.itemEstoque ? "Confirmar PI" : "Escolher item do estoque"} />
            </li>
          ))}
        </ul>
      </section>
    );
  return (
    <FormAcao acao={acaoEmitirRecebimento} botao="Emitir Check-list da Contagem" className="space-y-5">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="doc" value="checklist" />
      <section className="cartao space-y-4 p-5">
        <div>
          {titulo}
          <p className="mt-0.5 text-xs text-slate-500">Usa os dados do TAV nº {tav}. {modo === "contagem"
            ? <>Conferência por <strong>contagem manual</strong>: informe a quantidade contada de cada item; a diferença para a NF é calculada na hora.</>
            : modo === "pesagem" ? <>Conferência por <strong>pesagem</strong>: para cada item, informe o peso encontrado (já sem a tara da caixa) e se houve discrepância.</>
            : "Escolha como a conferência foi feita."}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-y border-slate-100 py-3">
          <span className="text-sm text-slate-700">Conferência feita por *</span>
          <div className="flex shrink-0 gap-1.5">
            {["Contagem manual", "Pesagem"].map((o) => (
              <label key={o} className="cursor-pointer">
                <input type="radio" name="conferencia" value={o} checked={conferencia === o} onChange={() => setConferencia(o)} className="peer sr-only" required />
                <span className={`inline-flex h-8 min-w-14 items-center justify-center rounded-lg border px-3 text-sm font-medium transition peer-focus-visible:ring-4 peer-focus-visible:ring-marinha/20 ${conferencia === o ? "border-marinha bg-marinha text-white" : "border-slate-300 bg-white text-slate-700"}`}>{o}</span>
              </label>
            ))}
          </div>
        </div>
        {modo && <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="pb-2 pr-2">#</th>
                <th className="pb-2 pr-3">PI · Item</th>
                {modo === "contagem" ? <>
                  <th className="pb-2 pr-3 text-right">Qtd. NF</th>
                  <th className="pb-2 pr-3">Qtd. contada *</th>
                  <th className="pb-2">Diferença</th>
                </> : <>
                  <th className="pb-2 pr-3">Peso líq. (kg) *</th>
                  <th className="pb-2">Discrepância? *</th>
                </>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {linhas.map((l) => modo === "contagem"
                ? <LinhaContagemManual key={l.ref} l={l} anterior={anterior[l.ref]} />
                : <LinhaContagem key={l.ref} l={l} anterior={anterior[l.ref]} />)}
            </tbody>
          </table>
        </div>}
        <label className="block"><span className="rotulo">Observações gerais da contagem (opcional)</span>
          <textarea name="obs_contagem" defaultValue={inicial.obs_contagem} rows={3} maxLength={1500} className="campo" /></label>
      </section>
    </FormAcao>
  );
}
