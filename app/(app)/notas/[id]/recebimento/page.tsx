import { notFound, redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { etapasAtivas } from "@/lib/fluxo";
import { obterNota } from "@/lib/notas";
import { docsDaNota, numeroTav, PERGUNTAS_TAV, podeEmitirRecebimento, proximoTav, type DadosRecebimento } from "@/lib/recebimento";
import { cnpj, dataHora, destinoVolta, linkNota, moeda } from "@/lib/format";
import { Cabecalho, Selo, Voltar } from "@/components/ui";
import { FormChecklist, FormTav } from "@/components/FormRecebimento";

export const metadata = { title: "Documentos do Recebimento — Tramitação de NF" };

export default async function DocsRecebimento({ params, searchParams }: PageProps<"/notas/[id]/recebimento">) {
  const u = await exigirUsuario();
  const id = Number((await params).id);
  const sp = await searchParams;
  const [nota, etapas] = await Promise.all([obterNota(u, id), etapasAtivas()]);
  if (!nota) notFound();
  if (!podeEmitirRecebimento(u, etapas, nota)) redirect(linkNota(id, destinoVolta(sp.volta)?.href));
  const registros = await docsDaNota(id);
  const emitido = Number(sp.emitido) || null;
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const regTav = registros.find((r) => r.doc !== "checklist");
  const regChecklist = registros.find((r) => r.doc !== "tav");
  const vazio: DadosRecebimento = {
    numero_tav: "", data_recebimento: hoje, id_pa: "", lote: "", fabricacao: "", volumes: "",
    conferencia: "", respostas: PERGUNTAS_TAV.map((_, i) => (i < PERGUNTAS_TAV.length - 1 ? "Sim" : "")), observacao: "",
    peso_kg: "", itens_caixa: "", data_envio_amostra: "", obs_recebimento: "", discrepancia: "", obs_contagem: "",
  };
  const inicialTav = regTav?.dados.formulario ?? vazio;
  const anoAtual = Number(hoje.slice(0, 4));
  const reemissao = !!regTav && regTav.ano === anoAtual;
  const proximoNumero = reemissao ? numeroTav(regTav.numero_tav, regTav.ano) : numeroTav(await proximoTav(anoAtual), anoAtual);
  const inicialChecklist = regChecklist?.dados.formulario ?? vazio;
  const docEmitido = sp.doc === "checklist" ? "checklist" : "tav";
  const NOME = { tav: "TAV", checklist: "Check-list" } as const;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-3"><Voltar href={linkNota(id, destinoVolta(sp.volta)?.href)}>NF {nota.numero}</Voltar></div>
      <Cabecalho titulo="Documentos do Recebimento" descricao="Cada documento é emitido no seu momento: o TAV no Pré Recebimento e o Check-list na Contagem. Os dados da NF entram automaticamente e o número do TAV é gerado automaticamente (0001/2026, 0002/2026…)." />

      {emitido && registros.some((r) => r.id === emitido) && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <p className="text-sm text-emerald-900"><strong>{NOME[docEmitido]} emitido.</strong></p>
          <a href={`/api/recebimento/${emitido}?doc=${docEmitido}`} className="botao">Baixar {NOME[docEmitido]}</a>
        </div>
      )}

      <div className="cartao mb-5 grid gap-4 p-5 text-sm sm:grid-cols-3">
        <div><p className="rotulo">NF</p><p className="font-semibold text-slate-900">{nota.numero} <span className="ml-1 align-middle"><Selo nota={nota} /></span></p></div>
        <div><p className="rotulo">OC</p><p>{nota.oc ?? "—"}</p></div>
        <div><p className="rotulo">Valor</p><p>{moeda(nota.valor)}</p></div>
        <div className="sm:col-span-3"><p className="rotulo">Empresa</p><p>{nota.emit_nome} · {cnpj(nota.emit_cnpj)}</p></div>
      </div>

      <div className="space-y-6">
        <div id="tav" className="scroll-mt-20"><FormTav id={id} inicial={inicialTav} perguntas={PERGUNTAS_TAV} numeroTav={proximoNumero} reemissao={reemissao} /></div>
        <div id="checklist" className="scroll-mt-20"><FormChecklist id={id} inicial={inicialChecklist} tav={regTav ? numeroTav(regTav.numero_tav, regTav.ano) : null} /></div>
      </div>

      {registros.length > 0 && (
        <section className="cartao mt-6 p-5">
          <h2 className="mb-3 text-[15px] font-semibold text-slate-900">Já emitidos para esta NF</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {registros.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{r.doc === "checklist" ? "Check-list" : r.doc === "tav" ? "TAV" : "TAV e Check-list"} · TAV nº <strong>{numeroTav(r.numero_tav, r.ano)}</strong> · {dataHora(r.criado_em)}{r.por ? ` · ${r.por}` : ""}</span>
                <span className="flex gap-3">
                  {r.doc !== "checklist" && <a href={`/api/recebimento/${r.id}?doc=tav`} className="font-medium text-marinha hover:underline">Baixar TAV</a>}
                  {r.doc !== "tav" && <a href={`/api/recebimento/${r.id}?doc=checklist`} className="font-medium text-marinha hover:underline">Baixar Check-list</a>}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">Cada formulário vem preenchido com o último registro dele, para facilitar uma correção.</p>
        </section>
      )}
    </div>
  );
}
