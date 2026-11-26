import { notFound, redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { etapasAtivas } from "@/lib/fluxo";
import { obterNota } from "@/lib/notas";
import { docsDaNota, numeroTav, PERGUNTAS_TAV, podeEmitirRecebimento, podeMinutaTav, proximoTav, volumesEsperados, type DadosRecebimento } from "@/lib/recebimento";
import { cnpj, dataHora, destinoVolta, linkNota, moeda } from "@/lib/format";
import { Cabecalho, Selo, Voltar } from "@/components/ui";
import { FormChecklist, FormTav, type ContagemAnterior, type LinhaChecklist } from "@/components/FormRecebimento";
import { correlacionarNota } from "@/lib/estoque";
import { AssinarToken } from "@/components/AssinarToken";

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
  // data sugerida: o dia em que a SECOM cadastrou a NF no sistema (pode ser alterada)
  const recebida = nota.recebida_em ? new Date(nota.recebida_em).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) : hoje;
  const vazio: DadosRecebimento = {
    numero_tav: "", data_recebimento: recebida, id_pa: nota.id_pa ?? "", lote: "", fabricacao: "", volumes: "",
    // a pergunta 1 (quantidade de volumes) e a do laudo vêm sem resposta: a pessoa precisa responder
    conferencia: "", respostas: PERGUNTAS_TAV.map((_, i) => (i > 0 && i < PERGUNTAS_TAV.length - 1 ? "Sim" : "")), observacao: "",
    peso_kg: "", itens_caixa: "", data_envio_amostra: "", obs_recebimento: "", discrepancia: "", obs_contagem: "",
  };
  // reemissão: aproveita as respostas anteriores (TAV antigo de 7 perguntas: a 1 e a 2 viraram uma só), menos a 1, que é sempre respondida de novo
  const respostasAntes = regTav?.dados.formulario.respostas ?? [];
  const inicialTav = regTav ? {
    ...regTav.dados.formulario, id_pa: nota.id_pa ?? regTav.dados.formulario.id_pa,
    respostas: ["", ...(respostasAntes.length === 7 ? respostasAntes.slice(2) : respostasAntes.slice(1))],
  } : vazio;
  const anoAtual = Number(inicialTav.data_recebimento.slice(0, 4)) || Number(hoje.slice(0, 4));
  const reemissao = !!regTav && regTav.ano === anoAtual;
  const proximoNumero = reemissao ? numeroTav(regTav.numero_tav, regTav.ano) : numeroTav(await proximoTav(anoAtual), anoAtual);
  const inicialChecklist = regChecklist?.dados.formulario ?? vazio;
  // itens para a contagem, com o PI do estoque (os que estão "a verificar" ou sem correlação precisam ser confirmados antes)
  const correl = await correlacionarNota(nota);
  const volumesTav = await volumesEsperados({ emit_cnpj: nota.emit_cnpj, itens: nota.itens, dados: nota.dados });
  const linhasChecklist: LinhaChecklist[] = correl.linhas.map((l) => ({
    ref: l.ref, n: l.n, descricao: l.descricao, tamanho: l.tamanho, qtd: Number(l.qtd) || 0, un: l.un,
    pi: l.item?.pi ?? null, itemEstoque: l.item?.descricao ?? null, pendente: l.confianca === "media" || l.confianca === "nenhuma" || !l.item,
    candidatos: l.candidatos.map(({ pi, descricao, cxp }) => ({ pi, descricao, cxp })), confirmada: l.confianca === "confirmada",
  }));
  const contagemAnterior: ContagemAnterior = Object.fromEntries((regChecklist?.dados.formulario.contagem ?? []).map((c) => [c.ref, { peso: c.peso, discrepancia: c.discrepancia, diferenca: c.diferenca, contada: c.contada }]));
  const docEmitido = sp.doc === "checklist" ? "checklist" : "tav";
  const NOME = { tav: "TAV", checklist: "Check-list da Contagem" } as const;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-3"><Voltar href={linkNota(id, destinoVolta(sp.volta)?.href)}>NF {nota.numero}</Voltar></div>
      <Cabecalho titulo="Documentos do Recebimento" descricao="Cada documento é emitido no seu momento: o TAV no Pré Recebimento e o Check-list na Contagem. Os dados da NF entram automaticamente e o número do TAV é gerado automaticamente (0001/2026, 0002/2026…)." />

      {emitido && registros.some((r) => r.id === emitido) && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <p className="text-sm text-emerald-900"><strong>{NOME[docEmitido]} emitido.</strong> Assine com o token pelo Assinador SERPRO (o documento assinado já vai para a NF) ou baixe o PDF, assine no Adobe e anexe na NF.</p>
          <div className="flex flex-wrap items-center gap-3">
            <AssinarToken registroId={emitido} doc={docEmitido} />
            <a href={`/api/recebimento/${emitido}?doc=${docEmitido}`} className="botao-sec">Baixar PDF</a>
            {docEmitido === "tav" && <a href={`/api/recebimento/${emitido}?doc=tav&formato=modelo`} className="text-xs font-medium text-emerald-900 underline">versão editável</a>}
            <a href={`/notas/${id}#documentos`} className="text-xs font-medium text-emerald-900 underline">anexar o PDF assinado na NF</a>
          </div>
        </div>
      )}

      <div className="cartao mb-5 grid gap-4 p-5 text-sm sm:grid-cols-3">
        <div><p className="rotulo">NF</p><p className="font-semibold text-slate-900">{nota.numero} <span className="ml-1 align-middle"><Selo nota={nota} /></span></p></div>
        <div><p className="rotulo">OC</p><p>{nota.oc ?? "—"}</p></div>
        <div><p className="rotulo">Valor</p><p>{moeda(nota.valor)}</p></div>
        <div className="sm:col-span-3"><p className="rotulo">Empresa</p><p>{nota.emit_nome} · {cnpj(nota.emit_cnpj)}</p></div>
      </div>

      <div className="space-y-6">
        {podeMinutaTav(u, etapas, nota) && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-5 py-3">
            <p className="text-sm text-slate-600"><strong>Minuta do TAV:</strong> imprima para conferir o que está chegando. Não tem número, não é registrada e não segue no trâmite. Depois do recebimento, preencha e emita o TAV abaixo.</p>
            <a href={`/api/recebimento/minuta/${id}`} target="_blank" rel="noopener" className="botao-sec">Imprimir minuta do TAV</a>
          </div>
        )}
        <div id="tav" className="scroll-mt-20"><FormTav id={id} inicial={inicialTav} perguntas={PERGUNTAS_TAV} numeroTav={proximoNumero} reemissao={reemissao} volumes={volumesTav} /></div>
        <div id="checklist" className="scroll-mt-20"><FormChecklist id={id} inicial={inicialChecklist} tav={regTav ? numeroTav(regTav.numero_tav, regTav.ano) : null} linhas={linhasChecklist} anterior={contagemAnterior} catalogoVazio={correl.catalogoVazio}
          /></div>
      </div>

      {registros.length > 0 && (
        <section className="cartao mt-6 p-5">
          <h2 className="mb-3 text-[15px] font-semibold text-slate-900">Já emitidos para esta NF</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {registros.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{r.doc === "checklist" ? "Check-list da Contagem" : r.doc === "tav" ? "TAV" : "TAV e Check-list"} · TAV nº <strong>{numeroTav(r.numero_tav, r.ano)}</strong> · {dataHora(r.criado_em)}{r.por ? ` · ${r.por}` : ""}</span>
                <span className="flex gap-3">
                  {r.doc !== "checklist" && <AssinarToken registroId={r.id} doc="tav" rotulo="Assinar TAV com token" compacto />}
                  {r.doc !== "checklist" && <a href={`/api/recebimento/${r.id}?doc=tav`} className="font-medium text-marinha hover:underline">TAV em PDF</a>}
                  {r.doc !== "tav" && <AssinarToken registroId={r.id} doc="checklist" rotulo="Assinar Check-list com token" compacto />}
                  {r.doc !== "tav" && <a href={`/api/recebimento/${r.id}?doc=checklist`} className="font-medium text-marinha hover:underline">Check-list em PDF</a>}
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
