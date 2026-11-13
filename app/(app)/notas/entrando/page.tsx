import Link from "next/link";
import { redirect } from "next/navigation";
import { ehInterno, exigirUsuario } from "@/lib/auth";
import { itensEntrando, type FiltrosEntrando } from "@/lib/entrando";
import { etapasAtivas } from "@/lib/fluxo";
import { listarEmpresas } from "@/lib/notas";
import { numero } from "@/lib/format";
import { Cabecalho, Indicador, Vazio } from "@/components/ui";
import { AbasBusca } from "@/components/AbasBusca";

export const metadata = { title: "Itens entrando — Tramitação de NF" };

const q = (v: number) => numero(v, Number.isInteger(v) ? 0 : 2);

export default async function ItensEntrando({ searchParams }: PageProps<"/notas/entrando">) {
  const u = await exigirUsuario();
  if (!ehInterno(u)) redirect("/notas");
  const sp = await searchParams;
  const f: FiltrosEntrando = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const [{ grupos, resumo, catalogoVazio }, etapas, empresas] = await Promise.all([itensEntrando(f), etapasAtivas(), listarEmpresas()]);
  const maxQtd = Math.max(1, ...grupos.map((g) => g.qtd));

  return (
    <div className="space-y-4">
      <Cabecalho titulo="Notas fiscais" descricao="Itens que estão entrando: tudo o que está nas NF em tramitação (e nas finalizadas ainda não armazenadas), somado por item do estoque." />
      <AbasBusca atual="entrando" />

      <form className="cartao grid grid-cols-2 gap-3 p-4 md:grid-cols-4 lg:grid-cols-6" action="/notas/entrando">
        <label className="col-span-2">
          <span className="rotulo">Filtrar item</span>
          <input name="q" defaultValue={f.q ?? ""} className="campo" placeholder="Ex.: camisa M, dolma, 190100266, NF ou empresa" />
        </label>
        <label>
          <span className="rotulo">Onde está</span>
          <select name="etapa" defaultValue={f.etapa ?? ""} className="campo">
            <option value="">Todas as etapas</option>
            {etapas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            <option value="armazenar">Para armazenar</option>
          </select>
        </label>
        <label>
          <span className="rotulo">Empresa</span>
          <select name="cnpj" defaultValue={f.cnpj ?? ""} className="campo">
            <option value="">Todas</option>
            {empresas.map((e) => <option key={e.cnpj} value={e.cnpj}>{e.nome}</option>)}
          </select>
        </label>
        <label>
          <span className="rotulo">Ordenar por</span>
          <select name="ordem" defaultValue={f.ordem ?? ""} className="campo">
            <option value="">Maior quantidade</option><option value="notas">Mais NF</option><option value="nome">Nome do item</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" name="correlacao" value="sem" defaultChecked={f.correlacao === "sem"} /> Só sem correlação</label>
        </div>
        <div className="col-span-2 flex items-end gap-2 md:col-span-4 lg:col-span-6">
          <button className="botao">Filtrar</button>
          <Link href="/notas/entrando" className="botao-sec">Limpar</Link>
        </div>
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Indicador titulo="NF entrando" valor={numero(resumo.notas)} />
        <Indicador titulo="Itens diferentes" valor={numero(resumo.itens)} />
        <Indicador titulo="Quantidade total" valor={q(resumo.qtd)} />
        <Indicador titulo="Caixas previstas (CXP)" valor={numero(resumo.caixas)} />
        <Indicador titulo="Sem correlação" valor={numero(resumo.semCorrelacao)} cor={resumo.semCorrelacao > 0 ? "text-red-600" : undefined} />
      </div>
      {(catalogoVazio || resumo.semItens > 0) && (
        <p className="text-xs text-slate-500">
          {catalogoVazio && "O catálogo do estoque ainda não foi carregado: os itens aparecem pela descrição da NF. "}
          {resumo.semItens > 0 && `${resumo.semItens} NF entrando não têm itens cadastrados (sem XML/PDF da NF-e) e não aparecem aqui.`}
        </p>
      )}

      {!grupos.length ? <Vazio>Nenhum item entrando com esses filtros.</Vazio> : (
        <div className="cartao divide-y divide-slate-100 overflow-hidden">
          <div className="hidden grid-cols-[1fr_9rem_7rem_5rem_16rem] gap-4 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:grid">
            <span>Item no estoque (WMS)</span><span className="text-right">Quantidade</span><span className="text-right">Caixas</span><span className="text-right">NF</span><span>Onde está</span>
          </div>
          {grupos.map((g) => (
            <details key={g.chave} className="group">
              <summary className="grid cursor-pointer list-none grid-cols-2 gap-x-4 gap-y-1 px-4 py-3 hover:bg-slate-50 lg:grid-cols-[1fr_9rem_7rem_5rem_16rem] lg:items-center">
                <span className="col-span-2 min-w-0 lg:col-span-1">
                  <span className="flex items-start gap-2">
                    <span className="text-slate-400 transition group-open:rotate-90">▸</span>
                    {g.pi ? <span className="font-mono text-xs text-slate-500">{g.pi}</span> : <span className="whitespace-nowrap rounded bg-red-50 px-1.5 text-[10px] font-semibold uppercase text-red-700 ring-1 ring-red-200">Sem correlação</span>}
                    <span className="line-clamp-2 font-medium text-slate-900" title={g.descricao}>{g.descricao}</span>
                  </span>
                  <span className="mt-1 block h-1.5 rounded-full bg-slate-100"><span className="block h-1.5 rounded-full bg-marinha/70" style={{ width: `${Math.max(2, (g.qtd / maxQtd) * 100)}%` }} /></span>
                </span>
                <span className="text-right text-sm font-semibold tabular-nums">{q(g.qtd)} <span className="text-xs font-normal text-slate-500">{g.un}</span></span>
                <span className="text-right text-sm tabular-nums">{g.caixas ? numero(g.caixas) : "—"}{g.semCxp && <span className="block text-[10px] text-amber-700">sem CXP</span>}{g.cxp ? <span className="block text-[10px] text-slate-400">CXP {q(g.cxp)}</span> : null}</span>
                <span className="text-right text-sm tabular-nums">{g.notas.length}</span>
                <span className="col-span-2 flex flex-wrap gap-1 lg:col-span-1">
                  {g.porEtapa.map((p) => (
                    <span key={p.etapa} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-800 ring-1 ring-blue-200">{p.etapa} · {q(p.qtd)}</span>
                  ))}
                </span>
              </summary>
              <div className="bg-slate-50/70 px-4 pb-3 pt-1">
                <table className="tabela text-sm">
                  <thead><tr><th>NF</th><th>Empresa</th><th>Etapa</th><th className="text-right">Qtd.</th><th className="text-right">Caixas</th></tr></thead>
                  <tbody>
                    {g.notas.map((n, i) => (
                      <tr key={`${n.id}-${i}`}>
                        <td className="whitespace-nowrap">
                          <Link href={`/notas/${n.id}`} className="font-semibold text-marinha hover:underline">{n.numero}</Link>
                          {n.sobMedida && <span className="ml-1.5 rounded bg-violet-600 px-1 text-[10px] font-bold uppercase text-white">Sob medida</span>}
                          {n.tamanho && <span className="ml-1.5 text-xs text-slate-500">tam. {n.tamanho}</span>}
                        </td>
                        <td>{n.empresa}</td>
                        <td>{n.etapa}</td>
                        <td className="whitespace-nowrap text-right tabular-nums">{q(n.qtd)} {n.un}</td>
                        <td className="text-right tabular-nums">{n.caixas ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
