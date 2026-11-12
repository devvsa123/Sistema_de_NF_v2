import { notFound, redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { etapasAtivas } from "@/lib/fluxo";
import { obterNota } from "@/lib/notas";
import { docsDaNota, PERGUNTAS_TAV, podeEmitirRecebimento, proximoTav, type DadosRecebimento } from "@/lib/recebimento";
import { cnpj, dataHora, destinoVolta, linkNota, moeda } from "@/lib/format";
import { Cabecalho, Selo, Voltar } from "@/components/ui";
import { FormRecebimento } from "@/components/FormRecebimento";

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
  const ultimo = registros[0]?.dados.formulario;
  const inicial: DadosRecebimento = ultimo ?? {
    numero_tav: String(await proximoTav(Number(hoje.slice(0, 4)))), data_recebimento: hoje, id_pa: "", lote: "", fabricacao: "", volumes: "",
    conferencia: "", respostas: PERGUNTAS_TAV.map((_, i) => (i < PERGUNTAS_TAV.length - 1 ? "Sim" : "")), observacao: "",
    peso_kg: "", itens_caixa: "", data_envio_amostra: "", obs_recebimento: "", discrepancia: "", obs_contagem: "",
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-3"><Voltar href={linkNota(id, destinoVolta(sp.volta)?.href)}>NF {nota.numero}</Voltar></div>
      <Cabecalho titulo="Documentos do Recebimento" descricao="TAV (Termo de Abertura de Volumes) e Check-list de Recebimento. Os dados da NF entram automaticamente; o número do TAV é sugerido em sequência." />

      {emitido && registros.some((r) => r.id === emitido) && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <p className="text-sm text-emerald-900"><strong>Documentos emitidos.</strong> Baixe cada um:</p>
          <div className="flex gap-2">
            <a href={`/api/recebimento/${emitido}?doc=tav`} className="botao">Baixar TAV</a>
            <a href={`/api/recebimento/${emitido}?doc=checklist`} className="botao">Baixar Check-list</a>
          </div>
        </div>
      )}

      <div className="cartao mb-5 grid gap-4 p-5 text-sm sm:grid-cols-3">
        <div><p className="rotulo">NF</p><p className="font-semibold text-slate-900">{nota.numero} <span className="ml-1 align-middle"><Selo nota={nota} /></span></p></div>
        <div><p className="rotulo">OC</p><p>{nota.oc ?? "—"}</p></div>
        <div><p className="rotulo">Valor</p><p>{moeda(nota.valor)}</p></div>
        <div className="sm:col-span-3"><p className="rotulo">Empresa</p><p>{nota.emit_nome} · {cnpj(nota.emit_cnpj)}</p></div>
      </div>

      <FormRecebimento id={id} inicial={inicial} perguntas={PERGUNTAS_TAV} />

      {registros.length > 0 && (
        <section className="cartao mt-6 p-5">
          <h2 className="mb-3 text-[15px] font-semibold text-slate-900">Já emitidos para esta NF</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {registros.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>TAV nº <strong>{r.numero_tav}/{r.ano}</strong> · {dataHora(r.criado_em)}{r.por ? ` · ${r.por}` : ""}</span>
                <span className="flex gap-3">
                  <a href={`/api/recebimento/${r.id}?doc=tav`} className="font-medium text-marinha hover:underline">TAV</a>
                  <a href={`/api/recebimento/${r.id}?doc=checklist`} className="font-medium text-marinha hover:underline">Check-list</a>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">O formulário acima vem preenchido com o último registro, para facilitar uma correção.</p>
        </section>
      )}
    </div>
  );
}
