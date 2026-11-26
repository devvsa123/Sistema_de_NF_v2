import { checklistDaNota, documentosDaNota, tiposDocumento, valido, type ChecklistNF, type Documento } from "@/lib/documentos";
import type { Assinatura } from "@/lib/assinatura";
import { armazenamentoExterno } from "@/lib/arquivos";
import { dataHora } from "@/lib/format";
import { FormAcao } from "./FormAcao";
import { EnviarDocumento } from "./EnviarDocumento";
import { BotaoDocumentos } from "./DocumentosProcesso";
import { acaoRemoverDocumento } from "@/app/acoes/documentos";

const tamanho = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function SeloAssinatura({ a }: { a: Assinatura }) {
  const ok = a.integra;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 rounded-md px-2 py-0.5 text-[11px] ring-1 ${ok ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200"}`}>
      <span aria-hidden>{ok ? "✔" : "✖"}</span>
      <strong>{a.nome}</strong>
      <span>· {a.tipo === "gov.br" ? "gov.br" : a.tipo === "ICP-Brasil" ? "Certificado ICP-Brasil (token)" : a.emissor}</span>
      {a.quando && <span>· {dataHora(a.quando)}</span>}
      {!ok && <span>· assinatura não confere</span>}
    </span>
  );
}

/** Quadro "Documentos da NF" na página da nota. */
export async function DocumentosNota({ nota, podeAnexar, ehAdmin, usuarioId }: {
  nota: { id: number; numero: string; status: string; etapa_id: number | null; etapa_nome: string | null }; podeAnexar: boolean; ehAdmin: boolean; usuarioId: number;
}) {
  const [docs, tipos, check] = await Promise.all([documentosDaNota(nota.id), tiposDocumento(), checklistDaNota(nota)]);
  const pendentesAtual = new Set(check.etapas.filter((e) => e.atual).flatMap((e) => e.itens.filter((x) => !x.ok).map((x) => x.tipo)));
  const porTipo = new Map<string, Documento[]>();
  for (const d of docs) porTipo.set(d.tipo, [...(porTipo.get(d.tipo) ?? []), d]);

  return (
    <div id="documentos" className="cartao scroll-mt-20 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-900">Documentos da NF</h2>
          <p className="mt-0.5 text-xs text-slate-500">NF, OC, laudos e os documentos assinados de cada etapa. A assinatura digital dos PDFs é conferida no envio.</p>
          {docs.some((d) => !d.arquivo_excluido_em) && <div className="mt-2"><BotaoDocumentos notaId={nota.id} numero={nota.numero} total={docs.length} rotulo="Ver e assinar documentos" className="botao h-9 px-3 text-sm" /></div>}
        </div>
      </div>

      <ChecklistNota c={check} />

      {!docs.length ? <p className="mt-3 text-sm text-slate-500">Nenhum documento anexado.</p> : (
        <div className="mt-3 space-y-4">
          {[...porTipo.entries()].map(([tipo, lista]) => (
            <div key={tipo}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{tipo}</p>
              <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200">
                {lista.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5">
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm">
                        {d.arquivo_excluido_em ? <span className="font-medium text-slate-700">{d.nome_arquivo}</span>
                          : <a href={`/api/documentos/${d.id}`} target="_blank" rel="noopener" className="font-medium text-marinha hover:underline">{d.nome_arquivo}</a>}
                        {d.arquivo_excluido_em && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500" title="O arquivo está no pacote final baixado pelo Controle">Arquivo excluído na finalização · {dataHora(d.arquivo_excluido_em)}</span>}
                        <span className="text-xs text-slate-500"> · {tamanho(d.tamanho)} · enviado por {d.enviado_por_nome ?? "—"} em {dataHora(d.criado_em)}</span>
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {d.assinaturas.length ? d.assinaturas.map((a, i) => <SeloAssinatura key={i} a={a} />)
                          : <span className={`rounded-md px-2 py-0.5 text-[11px] ring-1 ${d.exige_assinatura ? "bg-red-50 text-red-700 ring-red-200" : "bg-slate-50 text-slate-500 ring-slate-200"}`}>Sem assinatura digital</span>}
                        {!valido(d) && <span className="rounded-md bg-red-50 px-2 py-0.5 text-[11px] text-red-700 ring-1 ring-red-200">Não vale como entregue</span>}
                      </div>
                    </div>
                    {!d.arquivo_excluido_em && <div className="flex items-center gap-3 text-xs">
                      <a href={`/api/documentos/${d.id}?baixar=1`} className="font-medium text-marinha hover:underline">Baixar</a>
                      {(ehAdmin || d.enviado_por === usuarioId) && (
                        <details className="relative">
                          <summary className="cursor-pointer list-none font-medium text-red-700 hover:underline">Remover</summary>
                          <div className="absolute right-0 z-10 mt-1 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
                            <FormAcao acao={acaoRemoverDocumento} botao="Remover documento" classeBotao="botao-perigo h-8 px-3 text-xs" className="space-y-2" confirmar="Remover este documento da NF?">
                              <input type="hidden" name="doc" value={d.id} />
                              <label className="block"><span className="rotulo">Motivo (vai para o histórico)</span><input name="motivo" required maxLength={500} className="campo" /></label>
                            </FormAcao>
                          </div>
                        </details>
                      )}
                    </div>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {podeAnexar && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <EnviarDocumento id={nota.id} tipos={tipos.map((t) => ({ id: t.id, nome: t.nome, exige: t.exige_assinatura, pendente: pendentesAtual.has(t.nome) }))} />
          {!armazenamentoExterno() && <p className="mt-2 text-[11px] text-slate-400">Arquivos guardados no banco de dados (armazenamento externo ainda não configurado).</p>}
        </div>
      )}
    </div>
  );
}

/** Check-list geral: documentos obrigatórios de todas as etapas e as assinaturas que faltam nos documentos anexados. */
function ChecklistNota({ c }: { c: ChecklistNF }) {
  const aviso = c.sobMedida && (
    <p className="mt-2 rounded-lg bg-violet-50 px-3 py-1.5 text-xs text-violet-900 ring-1 ring-violet-200">
      <strong>NF sob medida:</strong> TAV, Check-list da Contagem, Relatório e Parecer não são obrigatórios (o material é entregue direto ao usuário). Podem ser anexados normalmente.
    </p>
  );
  if (!c.etapas.length && !c.assinaturas.length) return aviso ? <div className="mt-4">{aviso}</div> : null;
  const tudoOk = !c.faltamDocumentos && !c.faltamAssinaturas;
  return (
    <div className={`mt-4 rounded-xl border p-4 ${tudoOk ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/40"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Check-list de documentos e assinaturas</h3>
        {aviso && <div className="w-full">{aviso}</div>}
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${tudoOk ? "bg-emerald-600 text-white" : "bg-amber-500 text-white"}`}>
          {tudoOk ? "✔ Tudo em ordem" : [c.faltamDocumentos && `${c.faltamDocumentos} documento(s)`, c.faltamAssinaturas && `${c.faltamAssinaturas} assinatura(s)`].filter(Boolean).join(" e ") + " pendente(s)"}
        </span>
      </div>

      {c.etapas.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {c.etapas.map((e) => {
            const falta = e.itens.some((x) => !x.ok);
            return (
              <div key={e.id} className={`rounded-lg border bg-white px-3 py-2 text-xs ${e.atual ? "border-marinha ring-2 ring-marinha/15" : "border-slate-200"}`}>
                <p className="flex items-center justify-between gap-2 font-semibold text-slate-700">
                  <span>{e.nome}</span>
                  {e.atual ? <span className="rounded bg-marinha px-1.5 py-0.5 text-[10px] uppercase text-white">etapa atual</span>
                    : e.passada ? <span className={`text-[10px] uppercase ${falta ? "text-red-600" : "text-emerald-700"}`}>{falta ? "ficou pendente" : "concluída"}</span>
                    : <span className="text-[10px] uppercase text-slate-400">próxima</span>}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {e.itens.map((x) => (
                    <li key={x.tipo} className={x.ok ? "text-emerald-700" : e.atual || e.passada ? "text-red-700" : "text-slate-500"}>
                      {x.ok ? "✔" : "✖"} {x.tipo}{x.exige_assinatura ? " (assinado)" : ""}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assinaturas nos documentos anexados</p>
        {c.assinaturas.length === 0 ? <p className="mt-1 text-sm text-emerald-700">✔ Os documentos anexados estão com todas as assinaturas.</p> : (
          <ul className="mt-1 space-y-1 text-sm">
            {c.assinaturas.map((d) => (
              <li key={d.id} className="rounded-lg bg-white px-3 py-1.5 ring-1 ring-slate-200">
                <span className="font-medium text-slate-800">{d.tipo}</span> <span className="text-xs text-slate-500">{d.nome}</span>
                {d.faltam.length > 0 && <span className="block text-red-700">✍ {d.faltam.length === 1 ? "Falta a assinatura" : "Faltam as assinaturas"}: <strong>{d.faltam.join(", ")}</strong></span>}
                {d.invalida && <span className="block text-red-700">✖ Há assinatura que não confere com o arquivo.</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
