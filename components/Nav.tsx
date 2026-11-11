"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Icone } from "./Icone";

export type ItemMenu = { href: string; rotulo: string; icone: string };
export type GrupoMenu = { titulo: string; itens: ItemMenu[] };

/** Barra lateral do sistema (vira gaveta em telas pequenas). */
export function Lateral({ grupos, usuario, rodape }: { grupos: GrupoMenu[]; usuario: { nome: string; papel: string }; rodape: ReactNode }) {
  const caminho = usePathname();
  const [aberta, setAberta] = useState(false);
  const todos = grupos.flatMap((g) => g.itens);
  const casa = (href: string) => (href === "/" ? caminho === "/" : caminho === href || caminho.startsWith(href + "/"));
  const atual = todos.filter((i) => casa(i.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const titulo = todos.find((i) => i.href === atual)?.rotulo ?? "";

  const marca = (
    <Link href="/" className="flex items-center gap-3" onClick={() => setAberta(false)}>
      <Image src="/brasao.png" alt="" width={148} height={192} className="h-10 w-auto" />
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-tight text-white">Tramitação de NF</span>
        <span className="block text-xs text-slate-400">Depósito de Fardamento · RJ</span>
      </span>
    </Link>
  );

  return (
    <>
      {/* barra superior em telas pequenas */}
      <div className="sticky top-0 z-30 flex items-center gap-3 bg-[#0b1736] px-4 py-2.5 text-white lg:hidden print:hidden">
        <button onClick={() => setAberta(true)} className="rounded-md p-1.5 hover:bg-white/10" aria-label="Abrir menu"><Icone nome="menu" /></button>
        <span className="text-sm font-semibold">{titulo || "Tramitação de NF"}</span>
      </div>
      {aberta && <div className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden" onClick={() => setAberta(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-[#0b1736] text-slate-300 transition-transform lg:translate-x-0 print:hidden ${aberta ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-5">
          {marca}
          <button onClick={() => setAberta(false)} className="rounded-md p-1 hover:bg-white/10 lg:hidden" aria-label="Fechar menu"><Icone nome="fechar" /></button>
        </div>
        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
          {grupos.map((g) => (
            <div key={g.titulo}>
              <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{g.titulo}</p>
              <ul className="space-y-0.5">
                {g.itens.map((i) => {
                  const ativo = i.href === atual;
                  return (
                    <li key={i.href}>
                      <Link
                        href={i.href}
                        onClick={() => setAberta(false)}
                        className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                          ativo ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"
                        }`}
                      >
                        <span className={`${ativo ? "text-sky-300" : "text-slate-500 group-hover:text-slate-300"}`}><Icone nome={i.icone} /></span>
                        {i.rotulo}
                        {ativo && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sky-300" />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3 rounded-lg px-3 py-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sm font-semibold text-sky-200">
              {usuario.nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase()}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-medium text-white">{usuario.nome}</span>
              <span className="block text-xs text-slate-400">{usuario.papel}</span>
            </span>
          </div>
          {rodape}
        </div>
      </aside>
    </>
  );
}
