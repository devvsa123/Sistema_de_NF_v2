import Link from "next/link";
import { AmostragemPericia } from "@/components/AmostragemPericia";
import { notFound, redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { etapasAtivas } from "@/lib/fluxo";
import { obterNota } from "@/lib/notas";
import { laudosDaNota, nfDoLaudo, podeEmitirLaudo } from "@/lib/laudo";
import { cnpj, data, dataHora, destinoVolta, linkNota, moeda } from "@/lib/format";
import { Cabecalho, Selo, Voltar } from "@/components/ui";
import { FormLaudo } from "@/components/FormLaudo";
import { BotaoDocumentos } from "@/components/DocumentosProcesso";

export const metadata = { title: "Parecer da Divisão Técnica — Tramitação de NF" };

export default async function Laudo({ params, searchParams }: PageProps<"/notas/[id]/laudo">) {
  const u = await exigirUsuario();
  const id = Number((await params).id);
  const etapas = await etapasAtivas();
  if (!podeEmitirLaudo(u, etapas)) redirect(`/notas/${id}`);
  const [nota, nf, laudos] = await Promise.all([obterNota(u, id), nfDoLaudo(id), laudosDaNota(id)]);
  if (!nota || !nf) notFound();
  const sp = await searchParams;
  const emitido = Number(sp.emitido) || null;
  const ultimo = laudos[0]?.dados.formulario;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-3"><Voltar href={linkNota(id, destinoVolta(sp.volta)?.href)}>NF {nota.numero}</Voltar></div>
      <Cabecalho titulo="Parecer da Divisão Técnica" descricao="Preencha o resultado da perícia. O número do parecer, os dados da NF e os campos fixos (Diretor, posto e cargo) entram automaticamente." />
      <div className="mb-5"><AmostragemPericia nota={nota} /></div>

      {emitido && laudos.some((l) => l.id === emitido) && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <p className="text-sm text-emerald-900"><strong>Parecer emitido.</strong> O <strong>Parecer da Divisão Técnica em PDF</strong> já foi anexado em Documentos da NF, com os campos de assinatura do Perito, do Encarregado da Divisão Técnica e do Diretor.</p>
          <div className="flex flex-wrap gap-2">
            <BotaoDocumentos notaId={id} numero={nota.numero} total={1} rotulo="Assinar o parecer" className="botao" />
            <a href={`/api/laudos/${emitido}`} className="botao-sec">Versão editável (.docx)</a>
          </div>
        </div>
      )}

      <div className="cartao mb-5 grid gap-4 p-5 text-sm sm:grid-cols-3">
        <div><p className="rotulo">NF</p><p className="font-semibold text-slate-900">{nota.numero} <span className="ml-1 align-middle"><Selo nota={nota} /></span></p></div>
        <div><p className="rotulo">OC</p><p>{nota.oc ?? "—"}</p></div>
        <div><p className="rotulo">Entrada na perícia</p><p>{nf.entrada_pericia ? data(nf.entrada_pericia) : "—"}</p></div>
        <div className="sm:col-span-2"><p className="rotulo">Empresa</p><p>{nota.emit_nome} · {cnpj(nota.emit_cnpj)}</p></div>
        <div><p className="rotulo">Valor</p><p>{moeda(nota.valor)}</p></div>
      </div>

      <FormLaudo id={id} inicial={ultimo ?? {}} />

      {laudos.length > 0 && (
        <section className="cartao mt-6 p-5">
          <h2 className="mb-3 text-[15px] font-semibold text-slate-900">Pareceres já emitidos para esta NF</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {laudos.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>Parecer nº <strong>{l.protocolo || "—"}</strong> · {dataHora(l.criado_em)}{l.por ? ` · ${l.por}` : ""}</span>
                <a href={`/api/laudos/${l.id}`} className="font-medium text-marinha hover:underline">Baixar .docx</a>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">O formulário acima vem preenchido com o último parecer, para facilitar uma correção. <Link href="/manual#parecer" className="underline">Ver no manual</Link></p>
        </section>
      )}
    </div>
  );
}
