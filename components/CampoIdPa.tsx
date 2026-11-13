"use client";

import { useState, useTransition } from "react";
import { acaoIdPaFila } from "@/app/acoes/notas";

/** ID de PA na fila: quem pode alterar digita e salva ali mesmo (Enter ou ao sair do campo). */
export function CampoIdPa({ id, numero, valor, editavel, exigido }: { id: number; numero: string; valor: string; editavel: boolean; exigido: boolean }) {
  const [texto, setTexto] = useState(valor);
  const [salvo, setSalvo] = useState(valor);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);
  const [pendente, iniciar] = useTransition();
  // quando a fila recarrega com outro valor (outro usuário alterou), o campo acompanha
  const [base, setBase] = useState(valor);
  if (valor !== base) { setBase(valor); setTexto(valor); setSalvo(valor); }

  if (!editavel)
    return valor ? <span className="font-mono text-sm">{valor}</span>
      : exigido ? <span className="text-xs font-medium text-red-700">Pendente</span>
      : <span className="text-slate-400">—</span>;

  function salvar() {
    const v = texto.trim();
    if (v === salvo) return;
    iniciar(async () => {
      const r = await acaoIdPaFila(id, v);
      if (r.erro) { setErro(r.erro); setOk(false); return; }
      setSalvo(v); setTexto(v); setErro(""); setOk(true);
      setTimeout(() => setOk(false), 2500);
    });
  }

  const falta = exigido && !salvo;
  return (
    <div className="w-32">
      <input
        value={texto} onChange={(e) => { setTexto(e.target.value); setErro(""); }} onBlur={salvar}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") setTexto(salvo); }}
        maxLength={30} inputMode="numeric" disabled={pendente} aria-label={`ID de PA da NF ${numero}`} placeholder={falta ? "Obrigatório" : "Informar"}
        className={`h-8 w-full rounded-md border px-2 font-mono text-sm outline-none transition focus:border-marinha focus:ring-2 focus:ring-marinha/20 ${
          erro ? "border-red-400 bg-red-50" : falta ? "border-red-300 bg-red-50/60 placeholder:text-red-400" : "border-slate-300 bg-white"}`}
      />
      {pendente ? <span className="block text-[11px] text-slate-500">Salvando…</span>
        : erro ? <span className="block text-[11px] leading-tight text-red-700">{erro}</span>
        : ok ? <span className="block text-[11px] text-emerald-700">Salvo no histórico</span>
        : null}
    </div>
  );
}
