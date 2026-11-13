import Link from "next/link";
import { correlacionarNota, configWms, situacaoEstoque, situacaoUz } from "@/lib/estoque";
import type { Nota } from "@/lib/notas";
import { numero, dataHora } from "@/lib/format";
import { CorrigirCorrelacao } from "./CorrigirCorrelacao";
import { FormAcao } from "./FormAcao";
import { acaoSalvarIdPa } from "@/app/acoes/estoque";

const SELO: Record<string, [string, string]> = {
  pi: ["PI na nota", "bg-emerald-50 text-emerald-700 ring-emerald-200"],
  confirmada: ["Confirmada", "bg-emerald-50 text-emerald-700 ring-emerald-200"],
  alta: ["Automática", "bg-sky-50 text-sky-700 ring-sky-200"],
  media: ["Verificar", "bg-amber-50 text-amber-800 ring-amber-200"],
  nenhuma: ["Sem correlação", "bg-red-50 text-red-700 ring-red-200"],
};
const qtd = (v: number) => numero(v, Number.isInteger(v) ? 0 : 2);

/** Correlação dos itens da NF com o estoque do WMS e plano de caixas pelo CXP. */
export async function ItensEstoque({ nota, podeCorrigir }: { nota: Nota; podeCorrigir: boolean }) {
  if (!nota.itens?.length) return null;
  const [{ linhas, catalogoVazio }, sit] = await Promise.all([correlacionarNota(nota), situacaoEstoque()]);
  if (catalogoVazio)
    return (
      <div className="cartao p-5 text-sm text-slate-600">
        <h2 className="text-[15px] font-semibold text-slate-900">Itens × estoque (WMS)</h2>
        <p className="mt-1">O catálogo do estoque ainda não foi carregado. O administrador geral pode atualizá-lo em <Link href="/admin/estoque" className="font-medium text-marinha underline">Administração → Estoque (WMS)</Link>.</p>
      </div>
    );
  const semCorrelacao = linhas.filter((l) => !l.item).length;
  const totais = linhas.reduce((a, l) => ({ cheias: a.cheias + (l.caixas?.cheias ?? 0), frac: a.frac + (l.caixas?.fracionada ? 1 : 0), total: a.total + (l.caixas?.total ?? 0) }), { cheias: 0, frac: 0, total: 0 });
  const semCxp = linhas.filter((l) => l.item && !l.caixas).length;
  const volumes = (nota.dados?.transp?.volumes ?? []).reduce((s, v) => s + (Number(v.qVol) || 0), 0);
  return (
    <div className="cartao overflow-x-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-900">Itens × estoque (WMS) e plano de caixas</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Cada item da NF ligado ao item do estoque, com o padrão de caixa (CXP).
            {sit && ` Catálogo atualizado em ${dataHora(sit.em)}.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <p><span className="block text-xs text-slate-500">Caixas pelo padrão</span><strong className="text-lg">{totais.total}</strong> <span className="text-xs text-slate-500">({totais.cheias} cheias{totais.frac ? ` + ${totais.frac} fracionada(s)` : ""})</span></p>
          {volumes > 0 && <p><span className="block text-xs text-slate-500">Volumes na NF</span><strong className="text-lg">{volumes}</strong></p>}
          {semCorrelacao > 0 && <p><span className="block text-xs text-slate-500">Sem correlação</span><strong className="text-lg text-red-600">{semCorrelacao}</strong></p>}
        </div>
      </div>
      {(semCorrelacao > 0 || semCxp > 0) && (
        <p className="mx-5 mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {semCorrelacao > 0 && `${semCorrelacao} item(ns) sem item correspondente no estoque — o total de caixas não inclui esses itens. `}
          {semCxp > 0 && `${semCxp} item(ns) sem CXP cadastrado no WMS.`}
        </p>
      )}
      <table className="tabela mt-3">
        <thead>
          <tr><th>#</th><th>Item da NF</th><th className="text-right">Qtd.</th><th>Item no estoque (WMS)</th><th>Correlação</th><th className="text-right">CXP</th><th className="text-right">Caixas cheias</th><th className="text-right">Fracionada</th><th className="text-right">Total</th></tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            const [rot, cor] = SELO[l.confianca];
            return (
              <tr key={l.n} className={!l.item ? "bg-red-50/30" : l.confianca === "media" ? "bg-amber-50/30" : ""}>
                <td>{l.n}</td>
                <td className="min-w-64">
                  <span className="font-medium text-slate-800">{l.descricao}</span>
                  {l.infAd && <span className="block text-xs text-slate-500">{l.infAd}</span>}
                  {l.codigo && <span className="block font-mono text-[11px] text-slate-400">cód. {l.codigo}</span>}
                </td>
                <td className="whitespace-nowrap text-right tabular-nums">{qtd(l.qtd)} {l.un}</td>
                <td className="min-w-56">
                  {l.item ? <><span className="font-mono text-xs text-slate-500">{l.item.pi}</span> <span className="text-slate-800">{l.item.descricao}</span></>
                    : <span className="text-red-700">{l.candidatos.length ? "Mais de uma opção — escolha" : "Nenhum item correspondente no estoque"}</span>}
                  {podeCorrigir && (
                    <div><CorrigirCorrelacao id={nota.id} n={l.n} candidatos={l.candidatos.map(({ pi, descricao, cxp }) => ({ pi, descricao, cxp }))} confirmada={l.confianca === "confirmada"}
                      rotulo={l.item ? (l.confianca === "media" ? "Confirmar ou trocar" : "Trocar") : "Escolher item do estoque"} /></div>
                  )}
                </td>
                <td><span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${cor}`}>{rot}</span></td>
                <td className="text-right tabular-nums">{l.item?.cxp ?? "—"}</td>
                <td className="text-right tabular-nums">{l.caixas ? l.caixas.cheias : "—"}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{l.caixas ? (l.caixas.fracionada ? `1 cx c/ ${qtd(l.caixas.fracionada)}` : "—") : "—"}</td>
                <td className="text-right font-semibold tabular-nums">{l.caixas ? l.caixas.total : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-5 py-3 text-xs text-slate-500">
        “Automática” e “Verificar” vêm da comparação das descrições; ao confirmar ou trocar, o sistema passa a usar a mesma correlação nas próximas NF deste fornecedor.
      </p>
    </div>
  );
}

/** ID de PA e alocação das UZ (paletes) no WMS. */
export async function AlocacaoWms({ nota, podeEditar }: { nota: Nota; podeEditar: boolean }) {
  const [c, s] = await Promise.all([configWms(), situacaoUz(nota.id_pa)]);
  const texto = {
    sem_planilha: "A conferência automática das UZ começa quando a planilha de alocação do WMS for publicada no repositório do RPA.",
    sem_id_pa: "Informe o ID de PA para conferir a alocação das UZ.",
    sem_dados: "Este ID de PA ainda não aparece na planilha de alocação do WMS.",
    ok: `Todas as ${s.total} UZ estão alocadas em LOC real.`,
    pendente: `${s.pendentes.length} de ${s.total} UZ ainda em ${c.locVirtual}.`,
  }[s.estado];
  const cor = s.estado === "ok" ? "text-emerald-700" : s.estado === "pendente" ? "text-red-700" : "text-slate-600";
  return (
    <div className="cartao flex flex-wrap items-start justify-between gap-4 p-5">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-slate-900">Alocação no WMS</h2>
        <p className={`mt-1 text-sm ${cor}`}>{texto}</p>
        {s.estado === "pendente" && (
          <p className="mt-1 text-xs text-slate-600">UZ em {c.locVirtual}: {s.pendentes.map((p) => p.uz).join(", ")}</p>
        )}
        {c.exigirUz && <p className="mt-1 text-xs text-slate-500">A armazenagem só é liberada com todas as UZ alocadas.</p>}
      </div>
      <div className="text-sm">
        {podeEditar ? (
          <FormAcao acao={acaoSalvarIdPa} botao="Salvar" className="flex items-end gap-2" classeBotao="botao-sec h-10">
            <input type="hidden" name="id" value={nota.id} />
            <label><span className="rotulo">ID de PA</span><input name="id_pa" defaultValue={nota.id_pa ?? ""} className="campo w-40 font-mono" maxLength={30} inputMode="numeric" /></label>
          </FormAcao>
        ) : (
          <p><span className="rotulo">ID de PA</span><span className="font-mono">{nota.id_pa ?? "—"}</span></p>
        )}
      </div>
    </div>
  );
}
