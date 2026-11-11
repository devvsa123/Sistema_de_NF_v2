"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Nav({ itens }: { itens: { href: string; rotulo: string }[] }) {
  const caminho = usePathname();
  // item ativo = o de endereço mais longo que casa com a página atual
  const casa = (href: string) => (href === "/" ? caminho === "/" : caminho === href || caminho.startsWith(href + "/"));
  const atual = itens.filter((i) => casa(i.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav className="flex flex-wrap gap-1">
      {itens.map((i) => {
        const ativo = i.href === atual;
        return (
          <Link
            key={i.href}
            href={i.href}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${ativo ? "bg-white text-marinha" : "text-white/85 hover:bg-white/15"}`}
          >
            {i.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
