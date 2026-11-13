import Link from "next/link";
import { ehInterno, exigirUsuario } from "@/lib/auth";
import { buscarItens, contarNotasSemItens, ITENS_POR_PAGINA, normalizar, termos, type FiltrosItens } from "@/lib/itens";
import { listarEmpresas } from "@/lib/notas";
import { data, linkNota, moeda, numero } from "@/lib/format";
import { Selo, Vazio, Cabecalho } from "@/components/ui";
import { AbasBusca } from "@/components/AbasBusca";

export const metadata = { title: "Itens das notas — Tramitação de NF" };

/** Destaca na descrição os trechos que casaram com a pesquisa (ignorando acentos). */
function Destaque({ texto, q }: { texto: string; q: string }) {
  const norm = Array.from(texto).map((c) => normalizar(c).charAt(0) || c).join("");
  const marcas = new Array(norm.length).fill(false);
  for (const { t, exato } of termos(q)) {
    const re = exato ? new RegExp(`(^|[^a-z0-9])(${t.replace(/[.]/g, "\\.")})(?=[^a-z0-9]|$)`, "g") : new RegExp(t.replace(/[.]/g, "\\."), "g");
    for (const m of norm.matchAll(re)) {
      const ini = m.index! + (exato ? m[1].length : 0);
      for (let k = ini; k < ini + t.length; k++) marcas[k] = true;
    }
  }
  const chars = Array.from(texto);
  const partes: { s: string; m: boolean }[] = [];
  chars.forEach((c, i) => {
    const ult = partes[partes.length - 1];
    if (ult && ult.m === marcas[i]) ult.s += c; else partes.push({ s: c, m: marcas[i] });
  });
  return <>{partes.map((p, i) => (p.m ? <mark key={i} className="rounded bg-amber-100 px-0.5 text-slate-900">{p.s}</mark> : <span key={i}>{p.s}</span>))}</>;
}

export default async function BuscaItens({ searchParams }: PageProps<"/notas/itens">) {
  const u = await exigirUsuario();
  const sp = await searchParams;
  const f: FiltrosItens = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const interno = ehInterno(u);
  const [r, empresas, cobertura] = await Promise.all([buscarItens(u, f), interno ? listarEmpresas() : [], contarNotasSemItens(u)]);
  const paginas = Math.max(1, Math.ceil(r.total / ITENS_POR_PAGINA));
  const qs = (extra: Record<string, string>) =>
    new URLSearchParams(Object.entries({ ...f, ...extra }).filter(([, v]) => v) as [string, string][]).toString();
  const q = f.q ?? "";

  // agrupa os itens consecutivos da mesma NF
  const grupos: { nota: (typeof r.linhas)[number]; itens: typeof r.linhas }[] = [];
  for (const l of r.linhas) {
    const g = grupos[grupos.length - 1];
    if (g && g.nota.nota_id === l.nota_id) g.itens.push(l); else grupos.push({ nota: l, itens: [l] });
  }

  return (
    <div className="space-y-4">
      <Cabecalho titulo={interno ? "Notas fiscais" : "Minhas notas fiscais"} descricao="Pesquise as notas pelo número, chave, empresa, OC ou empenho, ou procure pelos itens comprados.">
        {r.total > 0 && <a href={`/api/itens/csv?${qs({ pagina: "" })}`} className="botao-sec">Exportar planilha (CSV)</a>}
      </Cabecalho>
      <AbasBusca atual="itens" interno={interno} />

      <form className="cartao grid grid-cols-2 gap-3 p-4 md:grid-cols-4 lg:grid-cols-6" action="/notas/itens">
        <label className="col-span-2 lg:col-span-3">
          <span className="rotulo">Item procurado</span>
          <input name="q" defaultValue={q} className="campo" placeholder="Ex.: camisa M, calça 42, US.02.001" autoFocus />
        </label>
        <label>
          <span className="rotulo">Situação da NF</span>
          <select name="situacao" defaultValue={f.situacao ?? ""} className="campo">
            <option value="">Todas</option>
            <option value="em_aberto">Em aberto (em trâmite ou reprovada)</option>
            <option value="em_tramite">Em trâmite</option>
            <option value="finalizada">{interno ? "Finalizada" : "Enviada para o COMRJ"}</option>
            <option value="reprovada">Reprovada</option>
            <option value="retirada">Retirada pelo fornecedor</option>
          </select>
        </label>
        <label>
          <span className="rotulo">Recebida de</span>
          <input type="date" name="de" defaultValue={f.de} className="campo" />
        </label>
        <label>
          <span className="rotulo">Recebida até</span>
          <input type="date" name="ate" defaultValue={f.ate} className="campo" />
        </label>
        {interno && (
          <label className="col-span-2">
            <span className="rotulo">Empresa</span>
            <select name="cnpj" defaultValue={f.cnpj ?? ""} className="campo">
              <option value="">Todas</option>
              {empresas.map((e) => <option key={e.cnpj} value={e.cnpj}>{e.nome}</option>)}
            </select>
          </label>
        )}
        <div className="col-span-2 flex items-end gap-2">
          <button className="botao">Pesquisar itens</button>
          {q && <Link href="/notas/itens" className="botao-sec">Limpar</Link>}
        </div>
      </form>

      <p className="text-xs text-slate-500">
        A pesquisa ignora acentos e aceita palavras parecidas (“camisa” também encontra “camiseta”). Tamanhos e números curtos, como M, GG ou 42, precisam aparecer como palavra inteira.
        Procura no nome do produto, na descrição completa informada pela empresa (informações adicionais do item) e no código.
        {cobertura.sem > 0 && ` ${cobertura.sem.toLocaleString("pt-BR")} de ${cobertura.total.toLocaleString("pt-BR")} NF ainda não têm os itens cadastrados (sem XML ou PDF da consulta) e não aparecem aqui.`}
      </p>

      {!q.trim() ? (
        <Vazio>Digite o item que procura para ver em quais notas fiscais ele aparece.</Vazio>
      ) : r.total === 0 ? (
        <Vazio>Nenhum item encontrado para “{q}”. Tente menos palavras ou outra grafia.</Vazio>
      ) : (
        <>
          <div className="cartao flex flex-wrap gap-x-8 gap-y-2 px-4 py-3 text-sm text-slate-700">
            <span><strong>{r.total.toLocaleString("pt-BR")}</strong> item(ns) em <strong>{r.notas.toLocaleString("pt-BR")}</strong> nota(s)</span>
            <span>Valor dos itens: <strong>{moeda(r.valor)}</strong></span>
            <span>Quantidade: {r.porUnidade.map((x) => <strong key={x.un} className="mr-2">{numero(x.qtd, Number.isInteger(x.qtd) ? 0 : 2)} {x.un}</strong>)}</span>
          </div>

          <div className="cartao overflow-x-auto">
            <table className="tabela">
              <thead>
                <tr>
                  <th>NF</th><th>Item</th><th>Código</th><th className="text-right">Qtd.</th><th>Un.</th><th className="text-right">Vl. unitário</th><th className="text-right">Vl. total</th>
                </tr>
              </thead>
              <tbody>
                {grupos.map((g) => g.itens.map((i, k) => (
                  <tr key={`${i.nota_id}-${i.n}-${k}`} className={k === 0 ? "border-t-2 border-slate-200" : ""}>
                    {k === 0 && (
                      <td rowSpan={g.itens.length} className="min-w-48 bg-slate-50/60">
                        <Link href={linkNota(i.nota_id, `/notas/itens?${qs({})}`)} className="font-semibold text-marinha hover:underline">NF {i.numero}</Link>
                        <span className="mt-0.5 block"><Selo nota={i} paraEmpresa={!interno} /></span>
                        {interno && <span className="mt-1 block max-w-56 text-xs text-slate-600">{i.emit_nome}</span>}
                        <span className="block text-xs text-slate-400">Recebida {data(i.recebida_em)}{i.oc ? ` · OC ${i.oc}` : ""}</span>
                      </td>
                    )}
                    <td className="min-w-72">
                      <span className="font-medium text-slate-800"><Destaque texto={i.descricao ?? ""} q={q} /></span>
                      {i.infad && <span className="mt-0.5 block whitespace-pre-wrap text-xs leading-relaxed text-slate-600"><Destaque texto={i.infad} q={q} /></span>}
                    </td>
                    <td className="whitespace-nowrap text-xs">{i.codigo ? <Destaque texto={i.codigo} q={q} /> : "—"}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{numero(i.qtd, Number.isInteger(i.qtd) ? 0 : 2)}</td>
                    <td>{i.un}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{moeda(i.vunit)}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{moeda(i.vtotal)}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>

          {paginas > 1 && (
            <div className="flex items-center justify-center gap-3 text-sm">
              {r.pagina > 1 ? <Link className="botao-sec" href={`/notas/itens?${qs({ pagina: String(r.pagina - 1) })}`}>← Anterior</Link> : <span />}
              <span>Página {r.pagina} de {paginas}</span>
              {r.pagina < paginas && <Link className="botao-sec" href={`/notas/itens?${qs({ pagina: String(r.pagina + 1) })}`}>Próxima →</Link>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
