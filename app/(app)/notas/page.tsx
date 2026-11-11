import Link from "next/link";
import { ehInterno, exigirUsuario } from "@/lib/auth";
import { etapasAtivas, prazoReprovada } from "@/lib/fluxo";
import { buscarNotas, listarEmpresas, POR_PAGINA, type Filtros } from "@/lib/notas";
import { cnpj, data, dias, moeda } from "@/lib/format";
import { Farol, Selo, Vazio } from "@/components/ui";

export const metadata = { title: "Notas fiscais — Tramitação de NF" };

export default async function Notas({ searchParams }: PageProps<"/notas">) {
  const u = await exigirUsuario();
  const sp = await searchParams;
  const f: Filtros = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const interno = ehInterno(u);
  const [etapas, prazoReprov, empresas] = await Promise.all([etapasAtivas(), prazoReprovada(), interno ? listarEmpresas() : []]);
  const { linhas, total, valorTotal, pagina } = await buscarNotas(u, f, prazoReprov);
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams(Object.entries({ ...f, ...extra }).filter(([, v]) => v) as [string, string][]);
    return p.toString();
  };
  const temFiltro = Object.entries(f).some(([k, v]) => v && k !== "pagina");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="titulo">{interno ? "Notas fiscais" : "Minhas notas fiscais"}</h1>
        <a href={`/api/notas/csv?${qs({ pagina: "" })}`} className="botao-sec">Exportar planilha (CSV)</a>
      </div>

      <form className="cartao grid grid-cols-2 gap-3 p-4 md:grid-cols-4 lg:grid-cols-6" action="/notas">
        <label className="col-span-2">
          <span className="rotulo">Pesquisa livre</span>
          <input name="q" defaultValue={f.q} className="campo" placeholder="Nº da NF, chave, empresa, CNPJ, OC, empenho, produto…" />
        </label>
        <label>
          <span className="rotulo">Situação</span>
          <select name="situacao" defaultValue={f.situacao ?? ""} className="campo">
            <option value="">Todas</option>
            <option value="em_tramite">Em trâmite (todas as etapas)</option>
            {interno && etapas.map((e) => <option key={e.id} value={`etapa:${e.id}`}>• {e.nome}</option>)}
            <option value="finalizada">{interno ? "Finalizada" : "Enviada para o COMRJ"}</option>
            <option value="reprovada">Reprovada</option>
            <option value="retirada">Retirada pelo fornecedor</option>
            <option value="concluidas">Todas as concluídas</option>
          </select>
        </label>
        {interno && (
          <label>
            <span className="rotulo">Empresa</span>
            <select name="cnpj" defaultValue={f.cnpj ?? ""} className="campo">
              <option value="">Todas</option>
              {empresas.map((e) => <option key={e.cnpj} value={e.cnpj}>{e.nome}</option>)}
            </select>
          </label>
        )}
        <label>
          <span className="rotulo">Recebida de</span>
          <input type="date" name="de" defaultValue={f.de} className="campo" />
        </label>
        <label>
          <span className="rotulo">Recebida até</span>
          <input type="date" name="ate" defaultValue={f.ate} className="campo" />
        </label>
        <label>
          <span className="rotulo">Valor mínimo</span>
          <input name="vmin" defaultValue={f.vmin} className="campo" inputMode="decimal" />
        </label>
        <label>
          <span className="rotulo">Valor máximo</span>
          <input name="vmax" defaultValue={f.vmax} className="campo" inputMode="decimal" />
        </label>
        <label>
          <span className="rotulo">XML</span>
          <select name="xml" defaultValue={f.xml ?? ""} className="campo">
            <option value="">Tanto faz</option><option value="sim">Com XML</option><option value="nao">Sem XML</option>
          </select>
        </label>
        {interno && (
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" name="atrasadas" value="1" defaultChecked={f.atrasadas === "1"} /> Somente fora do prazo
          </label>
        )}
        <div className="col-span-2 flex items-end gap-2">
          <button className="botao">Pesquisar</button>
          {temFiltro && <Link href="/notas" className="botao-sec">Limpar</Link>}
        </div>
      </form>

      <p className="text-sm text-slate-600">
        <strong>{total.toLocaleString("pt-BR")}</strong> nota(s) · valor total <strong>{moeda(valorTotal)}</strong>
      </p>

      {linhas.length === 0 ? (
        <Vazio>Nenhuma nota fiscal encontrada com esses filtros.</Vazio>
      ) : (
        <div className="cartao overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr>
                <th>NF</th>{interno && <th>Empresa</th>}<th className="text-right">Valor</th><th>OC</th><th>Situação</th>
                <th>Recebida</th><th>{interno ? "Na etapa há" : "Última movimentação"}</th><th>Tempo total</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((n) => (
                <tr key={n.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`/notas/${n.id}`} className="font-semibold text-marinha hover:underline">{n.numero}</Link>
                    {n.tem_xml && <span title="XML anexado" className="ml-1.5 rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-500">XML</span>}
                  </td>
                  {interno && (
                    <td className="max-w-64">
                      {n.emit_nome}
                      <span className="block text-xs text-slate-400">{cnpj(n.emit_cnpj)}</span>
                    </td>
                  )}
                  <td className="whitespace-nowrap text-right tabular-nums">{moeda(n.valor)}</td>
                  <td className="whitespace-nowrap">{n.oc}</td>
                  <td><Selo nota={n} paraEmpresa={!interno} /></td>
                  <td className="whitespace-nowrap">{data(n.recebida_em)}</td>
                  <td className="whitespace-nowrap">
                    {!interno ? data(n.etapa_desde) : n.status === "em_tramite" || n.status === "reprovada" ? (
                      <span className="inline-flex items-center gap-2">
                        <Farol dias={Number(n.dias_etapa)} prazo={n.status === "reprovada" ? prazoReprov : (n.prazo_dias ?? 0)} />
                        {dias(n.dias_etapa)}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="whitespace-nowrap">{dias(n.dias_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {paginas > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          {pagina > 1 ? <Link className="botao-sec" href={`/notas?${qs({ pagina: String(pagina - 1) })}`}>← Anterior</Link> : <span />}
          <span>Página {pagina} de {paginas}</span>
          {pagina < paginas && <Link className="botao-sec" href={`/notas?${qs({ pagina: String(pagina + 1) })}`}>Próxima →</Link>}
        </div>
      )}
    </div>
  );
}
