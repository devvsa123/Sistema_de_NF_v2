import Link from "next/link";
import { notFound } from "next/navigation";
import { ehInterno, exigirUsuario, podeCadastrar } from "@/lib/auth";
import { acoesPermitidas, etapasAtivas, prazoReprovada, vizinhos, type Acao } from "@/lib/fluxo";
import { eventosDaNota, obterNota, type Evento } from "@/lib/notas";
import { cnpj, data, dataHora, destinoVolta, dias, moeda, numero } from "@/lib/format";
import { Farol, Selo, Voltar } from "@/components/ui";
import { AcoesNota } from "@/components/AcoesNota";
import { FormAcao } from "@/components/FormAcao";
import type { BotaoFila } from "@/components/FilaTabela";
import { acaoAjusteAdmin, acaoEditarNota, acaoObservacao } from "@/app/acoes/notas";
import { laudosDaNota, podeEmitirLaudo } from "@/lib/laudo";
import { docsDaNota, podeEmitirRecebimento } from "@/lib/recebimento";

const TIPO: Record<string, string> = {
  cadastro: "Cadastro", avanco: "Avanço", retorno: "Devolução", reprovacao: "Reprovação", retirada: "Retirada", finalizacao: "Finalização",
  ajuste: "Ajuste do administrador", observacao: "Observação", laudo: "Laudo pericial", docs_recebimento: "Documentos do Recebimento", arrecadacao: "Arrecadação", armazenagem: "Armazenagem", xml: "Dados da NF-e",
};

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === "" || children === false) return null;
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{rotulo}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-800">{children}</dd>
    </div>
  );
}

export default async function DetalheNota({ params, searchParams }: PageProps<"/notas/[id]">) {
  const u = await exigirUsuario();
  const nota = await obterNota(u, Number((await params).id));
  if (!nota) notFound();
  const volta = destinoVolta((await searchParams).volta);
  const interno = ehInterno(u);
  const [eventos, etapas, prazoReprov, laudos, docsReceb] = await Promise.all([interno ? eventosDaNota(nota.id) : Promise.resolve([] as Evento[]), etapasAtivas(), prazoReprovada(), interno ? laudosDaNota(nota.id) : [], interno ? docsDaNota(nota.id) : []]);
  const perito = podeEmitirLaudo(u, etapas);
  const recebedor = podeEmitirRecebimento(u, etapas, nota);

  // Tempo em cada etapa, a partir do histórico de movimentações
  const movs = eventos.filter((e) => e.movimento);
  const fimGeral = nota.concluida_em ? new Date(nota.concluida_em) : new Date();
  const porEtapa = new Map<number, { dias: number; entrada: Date; saida: Date | null }>();
  movs.forEach((m, i) => {
    if (m.para_status !== "em_tramite" || !m.para_etapa_id) return;
    const saida = movs[i + 1] ? new Date(movs[i + 1].criado_em) : null;
    const d = ((saida ?? fimGeral).getTime() - new Date(m.criado_em).getTime()) / 864e5;
    const atual = porEtapa.get(m.para_etapa_id);
    porEtapa.set(m.para_etapa_id, { dias: (atual?.dias ?? 0) + d, entrada: atual?.entrada ?? new Date(m.criado_em), saida });
  });

  const permitidas = acoesPermitidas(u, nota, etapas);
  const { anterior, proxima } = vizinhos(etapas, nota.etapa_id);
  const ROTULOS: Record<Acao, BotaoFila> = {
    retornar: { acao: "retornar", rotulo: `← Devolver para ${anterior?.nome}`, estilo: "sec" },
    reprovar: { acao: "reprovar", rotulo: "Reprovar", estilo: "perigo" },
    arrecadar: { acao: "arrecadar", rotulo: "Marcar como arrecadada", estilo: "sec" },
    avancar: { acao: "avancar", rotulo: proxima ? `Enviar para ${proxima.nome} →` : "Finalizar ✓" },
    reabrir: { acao: "reabrir", rotulo: `← Voltar para ${nota.etapa_nome}`, estilo: "sec" },
    retirar: { acao: "retirar", rotulo: "Retirada pelo fornecedor" },
    armazenar: { acao: "armazenar", rotulo: "Marcar como armazenada", estilo: "sec" },
  };
  const botoes = (["retornar", "reabrir", "reprovar", "arrecadar", "armazenar", "retirar", "avancar"] as Acao[]).filter((a) => permitidas.includes(a)).map((a) => ROTULOS[a]);
  const d = nota.dados;
  const itens = nota.itens ?? [];
  const historico = interno ? eventos : movs;
  const emAberto = nota.status === "em_tramite" || nota.status === "reprovada";

  return (
    <div className="space-y-4">
      <Voltar href={volta?.href ?? "/notas"}>{volta?.rotulo ?? "Notas fiscais"}</Voltar>

      <div className="cartao p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-800">NF {nota.numero}{nota.serie ? <span className="text-base font-medium text-slate-400"> / série {nota.serie}</span> : null}</h1>
              <Selo nota={nota} paraEmpresa={!interno} />
              {nota.sob_medida && <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-semibold text-violet-700 ring-1 ring-inset ring-violet-200">Sob medida</span>}
            </div>
            <p className="mt-1 text-slate-700">{nota.emit_nome} <span className="text-sm text-slate-400">· {cnpj(nota.emit_cnpj)}</span></p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-marinha">{moeda(nota.valor)}</p>
            {nota.tem_xml && <a href={`/api/notas/${nota.id}/xml`} className="text-sm font-medium text-marinha hover:underline">Baixar XML</a>}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 md:grid-cols-4 lg:grid-cols-6">
          <Campo rotulo="OC">{nota.oc}</Campo>
          <Campo rotulo="Empenho">{nota.empenho}</Campo>
          <Campo rotulo="Emissão">{nota.data_emissao && data(nota.data_emissao)}</Campo>
          <Campo rotulo="Recebida em">{data(nota.recebida_em)}</Campo>
          <Campo rotulo={emAberto ? "Tempo em trâmite" : "Tempo total"}>{dias(nota.dias_total)}</Campo>
          <Campo rotulo="Concluída em">{nota.concluida_em && data(nota.concluida_em)}</Campo>
          {interno && <Campo rotulo="Arrecadada em">{nota.arrecadada_em && data(nota.arrecadada_em)}</Campo>}
          {interno && <Campo rotulo="Armazenada em">{nota.armazenada_em && data(nota.armazenada_em)}</Campo>}
          {interno && nota.status === "reprovada" && <Campo rotulo="Perícia visual">{nota.reprov_visual}</Campo>}
          {interno && nota.status === "reprovada" && <Campo rotulo="Perícia laboratorial">{nota.reprov_laboratorial}</Campo>}
        </dl>
        {nota.chave && <p className="mt-3 break-all font-mono text-xs text-slate-400">Chave: {nota.chave}</p>}
        {interno && nota.obs_oc && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"><strong>Observações da OC:</strong> {nota.obs_oc}</p>}
      </div>

      {/* Caminho da tramitação */}
      <div className="cartao overflow-x-auto p-5">
        <h2 className="mb-4 text-[15px] font-semibold text-slate-900">Caminho da tramitação</h2>
        <ol className="flex min-w-max items-start">
          {etapas.map((e, i) => {
            const p = porEtapa.get(e.id);
            const atual = emAberto && nota.etapa_id === e.id;
            const reprovadaAqui = atual && nota.status === "reprovada";
            // fornecedor não recebe o histórico: as etapas anteriores à atual contam como concluídas
            const posAtual = etapas.findIndex((x) => x.id === nota.etapa_id);
            const passou = interno ? !!p : nota.status === "finalizada" || (posAtual >= 0 && i <= posAtual);
            const feito = passou && !atual;
            return (
              <li key={e.id} className="flex items-start">
                {i > 0 && <span className={`mt-4 h-0.5 w-8 sm:w-12 ${passou ? "bg-marinha" : "bg-slate-200"}`} />}
                <div className="flex w-28 flex-col items-center text-center">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                    reprovadaAqui ? "bg-red-600 text-white" : atual ? "bg-marinha text-white ring-4 ring-marinha/20" : feito ? "bg-marinha/90 text-white" : "bg-slate-200 text-slate-500"}`}>
                    {reprovadaAqui ? "✕" : feito ? "✓" : i + 1}
                  </span>
                  <span className={`mt-1.5 text-xs font-semibold ${atual ? "text-marinha" : "text-slate-700"}`}>{e.nome}</span>
                  {interno && p && <span className="text-[11px] text-slate-500">{data(p.entrada)}</span>}
                  {interno && p && (
                    <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-500">
                      {interno && <Farol dias={p.dias} prazo={e.prazo_dias} />} {dias(p.dias)}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
          <li className="flex items-start">
            <span className={`mt-4 h-0.5 w-8 sm:w-12 ${nota.status === "finalizada" ? "bg-emerald-500" : "bg-slate-200"}`} />
            <div className="flex w-28 flex-col items-center text-center">
              <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${nota.status === "finalizada" ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-500"}`}>✓</span>
              <span className="mt-1.5 text-xs font-semibold text-slate-700">{interno ? "Finalizada" : "Enviada para o COMRJ"}</span>
              {interno && nota.status === "finalizada" && <span className="text-[11px] text-slate-500">{data(nota.concluida_em)}</span>}
            </div>
          </li>
        </ol>
        {nota.status === "reprovada" && interno && (
          <p className="mt-4 text-sm text-red-700">
            Reprovada há {dias(nota.dias_etapa)} (prazo para retirada: {prazoReprov} dias).
          </p>
        )}
      </div>

      {botoes.length > 0 && (
        <div className="cartao border-marinha/30 p-5">
          <h2 className="mb-3 text-[15px] font-semibold text-slate-900">Tramitar</h2>
          <AcoesNota id={nota.id} botoes={botoes} />
        </div>
      )}

      {(recebedor || docsReceb.length > 0) && (
        <div className="cartao flex flex-wrap items-start justify-between gap-4 p-5">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">Documentos do Recebimento</h2>
            {docsReceb.length === 0 ? <p className="mt-1 text-sm text-slate-500">Nenhum TAV ou Check-list emitido para esta NF.</p> : (
              <ul className="mt-2 space-y-1 text-sm">
                {docsReceb.map((r) => (
                  <li key={r.id}>
                    TAV nº <strong>{r.numero_tav}/{r.ano}</strong>
                    <span className="text-slate-500"> · {dataHora(r.criado_em)}{r.por ? ` · ${r.por}` : ""} · </span>
                    <a href={`/api/recebimento/${r.id}?doc=tav`} className="font-medium text-marinha hover:underline">TAV</a>
                    <span className="text-slate-300"> | </span>
                    <a href={`/api/recebimento/${r.id}?doc=checklist`} className="font-medium text-marinha hover:underline">Check-list</a>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {recebedor && <Link href={`/notas/${nota.id}/recebimento${volta ? `?volta=${encodeURIComponent(volta.href)}` : ""}`} className="botao">{docsReceb.length ? "Emitir novamente" : "Emitir TAV e Check-list"}</Link>}
        </div>
      )}

      {(perito || laudos.length > 0) && (
        <div className="cartao flex flex-wrap items-start justify-between gap-4 p-5">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">Laudo pericial</h2>
            {laudos.length === 0 ? <p className="mt-1 text-sm text-slate-500">Nenhum laudo emitido para esta NF.</p> : (
              <ul className="mt-2 space-y-1 text-sm">
                {laudos.map((l) => (
                  <li key={l.id}>
                    <a href={`/api/laudos/${l.id}`} className="font-medium text-marinha hover:underline">Protocolo {l.protocolo || "—"}</a>
                    <span className="text-slate-500"> · {dataHora(l.criado_em)}{l.por ? ` · ${l.por}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {perito && <Link href={`/notas/${nota.id}/laudo${volta ? `?volta=${encodeURIComponent(volta.href)}` : ""}`} className="botao">{laudos.length ? "Emitir novo laudo" : "Emitir laudo pericial"}</Link>}
        </div>
      )}

      {d && (
        <div className="cartao p-5">
          <h2 className="mb-4 text-[15px] font-semibold text-slate-900">Dados da NF-e{nota.fonte === "pdf" && <span className="ml-2 font-normal normal-case text-slate-400">lidos do PDF da consulta no Portal da NF-e</span>}</h2>
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Campo rotulo="Natureza da operação">{nota.natureza}</Campo>
            <Campo rotulo="Protocolo de autorização">{d.protocolo && `${d.protocolo}${d.autorizadaEm ? " · " + dataHora(d.autorizadaEm) : ""}`}</Campo>
            <Campo rotulo="Emitente">{[d.emit.fantasia, d.emit.municipio && `${d.emit.municipio}/${d.emit.uf}`, d.emit.fone].filter(Boolean).join(" · ")}</Campo>
            <Campo rotulo="Destinatário">{d.dest.nome && `${d.dest.nome}${d.dest.doc ? " · " + cnpj(d.dest.doc) : ""}`}</Campo>
            <Campo rotulo="Pedido / contrato">{[d.pedido, d.contrato].filter(Boolean).join(" · ")}</Campo>
            <Campo rotulo="Valor dos produtos">{moeda(d.totais.vProd)}</Campo>
            <Campo rotulo="Frete">{d.totais.vFrete ? moeda(d.totais.vFrete) : null}</Campo>
            <Campo rotulo="Desconto">{d.totais.vDesc ? moeda(d.totais.vDesc) : null}</Campo>
            <Campo rotulo="IPI">{d.totais.vIPI ? moeda(d.totais.vIPI) : null}</Campo>
            <Campo rotulo="ICMS">{d.totais.vICMS ? moeda(d.totais.vICMS) : null}</Campo>
            <Campo rotulo="Frete por conta">{d.transp.modFrete}</Campo>
            <Campo rotulo="Transportadora">{d.transp.transportadora}</Campo>
            <Campo rotulo="Volumes">
              {d.transp.volumes.map((v) => [v.qVol && `${v.qVol} ${v.esp || "vol."}`, v.pesoB && `${numero(v.pesoB, 2)} kg bruto`].filter(Boolean).join(" · ")).filter(Boolean).join(" | ")}
            </Campo>
            <Campo rotulo="Duplicatas">
              {d.duplicatas.map((x) => `${x.nDup ?? ""} ${x.dVenc ? "venc. " + x.dVenc.split("-").reverse().join("/") : ""} ${moeda(x.vDup)}`).join(" | ")}
            </Campo>
          </dl>
          {d.infCpl && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Informações complementares</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{d.infCpl}</p>
            </div>
          )}
        </div>
      )}

      {itens.length > 0 && (
        <div className="cartao overflow-x-auto">
          <h2 className="px-5 pt-5 text-[15px] font-semibold text-slate-900">Itens da nota ({itens.length})</h2>
          <table className="tabela mt-3">
            <thead>
              <tr><th>#</th><th>Código</th><th>Descrição</th><th>NCM</th><th>CFOP</th><th className="text-right">Qtd.</th><th>Un.</th><th className="text-right">Vl. unitário</th><th className="text-right">Vl. total</th></tr>
            </thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.n}>
                  <td>{i.n}</td>
                  <td className="whitespace-nowrap">{i.codigo}</td>
                  <td className="min-w-72"><span className="font-medium">{i.descricao}</span>{i.infAd && <span className="mt-0.5 block whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{i.infAd}</span>}</td>
                  <td>{i.ncm}</td>
                  <td>{i.cfop}</td>
                  <td className="text-right tabular-nums">{numero(i.qtd, Number.isInteger(i.qtd) ? 0 : 2)}</td>
                  <td>{i.un}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{moeda(i.vUnit)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{moeda(i.vTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!nota.fonte && podeCadastrar(u) && (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-600">
          Esta NF ainda não tem os dados da NF-e. {nota.chave && /^\d{44}$/.test(nota.chave)
            ? <>Envie o XML ou o PDF da consulta na SEFAZ em <Link href="/notas/nova" className="font-medium text-marinha hover:underline">Cadastrar NF</Link> — ele será anexado automaticamente pela chave de acesso.</>
            : "Como foi cadastrada sem chave de acesso, o arquivo não pode ser associado automaticamente."}
        </p>
      )}

      {!interno && (
        <div className="cartao grid gap-4 p-5 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Situação atual</p>
            <p className="mt-1"><Selo nota={nota} paraEmpresa /></p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Última movimentação</p>
            <p className="mt-1 text-sm font-medium text-slate-800">{data(nota.etapa_desde)}</p>
          </div>
        </div>
      )}

      {interno && <div className="grid gap-4 lg:grid-cols-3">
        <div className="cartao p-5 lg:col-span-2">
          <h2 className="mb-4 text-[15px] font-semibold text-slate-900">{interno ? "Histórico e observações" : "Movimentações"}</h2>
          <ol className="space-y-3 border-l-2 border-slate-200 pl-4">
            {historico.map((e) => (
              <li key={e.id} className="relative">
                <span className={`absolute -left-[23px] top-1.5 h-2.5 w-2.5 rounded-full ${e.tipo === "reprovacao" ? "bg-red-500" : e.movimento ? "bg-marinha" : "bg-slate-400"}`} />
                <p className="text-sm text-slate-800">
                  <strong>{e.movimento ? (e.de_nome ? `${e.de_nome} → ${interno || e.para_status !== "finalizada" ? e.para_nome : "Enviada para o COMRJ"}` : e.para_nome) : TIPO[e.tipo] ?? e.tipo}</strong>
                  {e.movimento && e.tipo !== "avanco" && e.tipo !== "cadastro" && <span className="ml-2 text-xs text-slate-500">({TIPO[e.tipo] ?? e.tipo})</span>}
                </p>
                {interno && e.texto && <p className="whitespace-pre-wrap text-sm text-slate-600">{e.texto}</p>}
                <p className="text-xs text-slate-400">{dataHora(e.criado_em)}{interno && e.usuario_nome ? ` · ${e.usuario_nome}` : ""}</p>
              </li>
            ))}
          </ol>
        </div>

        {(u.papel === "admin" || u.papel === "interno") && (
          <div className="space-y-4">
            <div className="cartao p-5">
              <h2 className="mb-3 text-[15px] font-semibold text-slate-900">Nova observação</h2>
              <FormAcao acao={acaoObservacao} botao="Registrar" className="space-y-3">
                <input type="hidden" name="id" value={nota.id} />
                <textarea name="texto" className="campo" rows={3} maxLength={2000} required />
              </FormAcao>
            </div>

            {podeCadastrar(u) && (
              <details className="cartao p-5">
                <summary className="cursor-pointer text-[15px] font-semibold text-slate-900">Editar OC e observações</summary>
                <FormAcao acao={acaoEditarNota} botao="Salvar" className="mt-3 space-y-3">
                  <input type="hidden" name="id" value={nota.id} />
                  <label className="block"><span className="rotulo">OC *</span><input name="oc" defaultValue={nota.oc ?? ""} className="campo" maxLength={60} required /></label>
                  <label className="block"><span className="rotulo">Observações da OC</span><textarea name="obs_oc" defaultValue={nota.obs_oc ?? ""} className="campo" rows={3} /></label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sob_medida" defaultChecked={nota.sob_medida} /> Material sob medida</label>
                </FormAcao>
              </details>
            )}

            {u.papel === "admin" && (
              <details className="cartao p-5">
                <summary className="cursor-pointer text-[15px] font-semibold text-slate-900">Ajuste do administrador</summary>
                <p className="mt-2 text-xs text-slate-500">Coloca a NF diretamente em qualquer etapa ou situação. Fica registrado no histórico.</p>
                <FormAcao acao={acaoAjusteAdmin} botao="Aplicar ajuste" className="mt-3 space-y-3" classeBotao="botao-perigo" confirmar="Confirma o ajuste desta NF?">
                  <input type="hidden" name="id" value={nota.id} />
                  <select name="destino" className="campo" required defaultValue="">
                    <option value="" disabled>Mover para…</option>
                    {etapas.map((e) => <option key={e.id} value={`etapa:${e.id}`}>{e.nome}</option>)}
                    <option value="finalizada">Finalizada</option>
                    <option value="retirada">Retirada pelo fornecedor</option>
                    <option value="arquivada">Arquivada</option>
                  </select>
                  <input name="motivo" className="campo" placeholder="Motivo do ajuste" required maxLength={500} />
                </FormAcao>
              </details>
            )}
          </div>
        )}
      </div>}
    </div>
  );
}
