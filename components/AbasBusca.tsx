import Link from "next/link";

/** Abas sublinhadas, usadas para alternar entre visões de uma mesma página. */
export function Abas({ itens, atual }: { itens: readonly (readonly [string, string, string])[]; atual: string }) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 print:hidden">
      {itens.map(([k, href, nome]) => (
        <Link key={k} href={href}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
            k === atual ? "border-marinha text-marinha" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"}`}>
          {nome}
        </Link>
      ))}
    </nav>
  );
}

/** Alterna entre a busca de notas e a busca de itens. */
export function AbasBusca({ atual }: { atual: "notas" | "itens" }) {
  return <Abas atual={atual} itens={[["notas", "/notas", "Notas fiscais"], ["itens", "/notas/itens", "Itens das notas"]]} />;
}
