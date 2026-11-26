import { amostragemPericia } from "@/lib/amostragem-nf";
import { NORMA_AMOSTRAGEM } from "@/lib/amostragem";
import type { ItemNF } from "@/lib/nfe";

const q = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** Quantas unidades periciar em cada item da NF (Tabela 1 da norma; itens PED com amostra dobrada). */
export async function AmostragemPericia({ nota, aberto = true }: { nota: { emit_cnpj: string; itens: ItemNF[] | null }; aberto?: boolean }) {
  if (!nota.itens?.length) return null;
  const lotes = await amostragemPericia(nota);
  if (!lotes.length) return null;
  const total = lotes.reduce((s, l) => s + l.amostras, 0);
  return (
    <details className="cartao group p-5" open={aberto}>
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-2 [&::-webkit-details-marker]:hidden">
        <span className="text-[15px] font-semibold text-slate-900">Amostragem para a perícia <span className="font-normal text-slate-500">· {total.toLocaleString("pt-BR")} unidade(s) a periciar</span></span>
        <span className="text-xs font-medium text-marinha group-open:hidden">Mostrar</span>
      </summary>
      <p className="mt-1 text-xs text-slate-500">{NORMA_AMOSTRAGEM}. Itens <strong>PED</strong> (conjunto camuflado multipropósito, conjunto operativo) com a amostra <strong>dobrada</strong>. A amostra é distribuída entre os tamanhos pela participação de cada um no lote (decimais desprezados; mínimo de 1).</p>
      <div className="mt-3 overflow-x-auto">
        <table className="tabela">
          <thead><tr><th>Item (lote)</th><th className="text-right">Qtd. NF</th><th>Faixa do lote</th><th className="text-right">Periciar</th><th className="text-center">Ac</th><th className="text-center">Re</th><th>Por tamanho</th></tr></thead>
          <tbody>
            {lotes.map((l) => (
              <tr key={l.nome + l.un}>
                <td className="min-w-56"><span className="font-medium text-slate-800">{l.nome}</span>
                  {l.ped && <span className="ml-1.5 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white" title="Item PED: amostra dobrada">PED ×2</span>}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{q(l.qtd)} {l.un}</td>
                <td className="whitespace-nowrap text-xs text-slate-500">{l.faixa}</td>
                <td className="text-right text-base font-bold tabular-nums text-marinha">{l.amostras}</td>
                <td className="text-center tabular-nums">{l.ac}</td>
                <td className="text-center tabular-nums">{l.re}</td>
                <td className="text-xs text-slate-600">{l.tamanhos.length > 1 || l.tamanhos[0]?.tamanho !== "—"
                  ? l.tamanhos.map((t) => `${t.tamanho}: ${t.amostra}`).join(" · ") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-slate-500"><strong>Ac</strong> = aceita com até esse número de peças com defeito · <strong>Re</strong> = rejeita a partir desse número.</p>
    </details>
  );
}
