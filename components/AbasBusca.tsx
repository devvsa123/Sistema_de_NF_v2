import Link from "next/link";

/** Alterna entre a busca de notas e a busca de itens. */
export function AbasBusca({ atual }: { atual: "notas" | "itens" }) {
  const abas = [["notas", "/notas", "Notas fiscais"], ["itens", "/notas/itens", "Itens das notas"]] as const;
  return (
    <nav className="flex gap-1.5">
      {abas.map(([k, href, nome]) => (
        <Link key={k} href={href}
          className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 ring-inset ${k === atual ? "bg-marinha text-white ring-marinha" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}>
          {nome}
        </Link>
      ))}
    </nav>
  );
}
