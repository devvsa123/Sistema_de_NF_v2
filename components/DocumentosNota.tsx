import { sql } from "@/lib/db";
import { documentosDaNota, pendencias, tiposDocumento, valido, type Documento } from "@/lib/documentos";
import type { Assinatura } from "@/lib/assinatura";
import { armazenamentoExterno } from "@/lib/arquivos";
import { dataHora } from "@/lib/format";
import { FormAcao } from "./FormAcao";
import { EnviarDocumento } from "./EnviarDocumento";
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
  nota: { id: number; status: string; etapa_id: number | null; etapa_nome: string | null }; podeAnexar: boolean; ehAdmin: boolean; usuarioId: number;
}) {
  const [docs, tipos, regra] = await Promise.all([
    documentosDaNota(nota.id), tiposDocumento(), nota.status === "em_tramite" ? pendencias(sql, nota.id, nota.etapa_id) : null,
  ]);
  const porTipo = new Map<string, Documento[]>();
  for (const d of docs) porTipo.set(d.tipo, [...(porTipo.get(d.tipo) ?? []), d]);

  return (
    <div id="documentos" className="cartao scroll-mt-20 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-900">Documentos da NF</h2>
          <p className="mt-0.5 text-xs text-slate-500">NF, OC, laudos e os documentos assinados de cada etapa. A assinatura digital dos PDFs é conferida no envio.</p>
        </div>
        {regra && regra.exigidos.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <p className="font-semibold text-slate-700">Para sair de {nota.etapa_nome}:</p>
            <ul className="mt-1 space-y-0.5">
              {regra.exigidos.map((t) => {
                const falta = regra.faltando.some((x) => x.id === t.id);
                return <li key={t.id} className={falta ? "text-red-700" : "text-emerald-700"}>{falta ? "✖" : "✔"} {t.nome}{t.exige_assinatura ? " (assinado)" : ""}</li>;
              })}
            </ul>
          </div>
        )}
      </div>

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
                        <a href={`/api/documentos/${d.id}`} target="_blank" rel="noopener" className="font-medium text-marinha hover:underline">{d.nome_arquivo}</a>
                        <span className="text-xs text-slate-500"> · {tamanho(d.tamanho)} · enviado por {d.enviado_por_nome ?? "—"} em {dataHora(d.criado_em)}</span>
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {d.assinaturas.length ? d.assinaturas.map((a, i) => <SeloAssinatura key={i} a={a} />)
                          : <span className={`rounded-md px-2 py-0.5 text-[11px] ring-1 ${d.exige_assinatura ? "bg-red-50 text-red-700 ring-red-200" : "bg-slate-50 text-slate-500 ring-slate-200"}`}>Sem assinatura digital</span>}
                        {!valido(d) && <span className="rounded-md bg-red-50 px-2 py-0.5 text-[11px] text-red-700 ring-1 ring-red-200">Não vale como entregue</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
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
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {podeAnexar && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <EnviarDocumento id={nota.id} tipos={tipos.map((t) => ({ id: t.id, nome: t.nome, exige: t.exige_assinatura, pendente: !!regra?.faltando.some((x) => x.id === t.id) }))} />
          {!armazenamentoExterno() && <p className="mt-2 text-[11px] text-slate-400">Arquivos guardados no banco de dados (armazenamento externo ainda não configurado).</p>}
        </div>
      )}
    </div>
  );
}
