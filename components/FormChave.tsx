"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { FormAcao } from "./FormAcao";
import { acaoCadastrarManual, acaoConsultarChave } from "@/app/acoes/notas";

type Lido = {
  uf: string; emissao: string; cnpj: string; modelo: string; serie: string; numero: string;
  nome: string | null; origemNome: string; ultimaOc: string | null;
};

const fmtCnpj = (d: string) => (d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d);
const fmtChave = (d: string) => d.replace(/(\d{4})(?=\d)/g, "$1 ");

/** Cadastro sem XML: a chave de acesso preenche número, série, CNPJ e empresa; falta só o valor. */
export function FormChave() {
  const [chave, setChave] = useState("");
  const [lido, setLido] = useState<Lido | null>(null);
  const [erro, setErro] = useState("");
  const [existente, setExistente] = useState<{ id: number; numero: string } | null>(null);
  const [campos, setCampos] = useState({ numero: "", cnpj: "", nome: "" });
  const [buscando, iniciar] = useTransition();

  function digitar(v: string) {
    const d = v.replace(/\D/g, "").slice(0, 44);
    setChave(d);
    if (lido) setCampos({ numero: "", cnpj: "", nome: "" }); // limpa o que veio da chave anterior
    setErro(""); setLido(null); setExistente(null);
    if (d.length === 44)
      iniciar(async () => {
        const r = await acaoConsultarChave(d);
        if (r.erro || !r.dados) return setErro(r.erro ?? "Não foi possível ler a chave.");
        setLido(r.dados);
        setExistente(r.existente);
        setCampos({ numero: r.dados.numero, cnpj: fmtCnpj(r.dados.cnpj), nome: r.dados.nome ?? "" });
      });
  }

  return (
    <FormAcao acao={acaoCadastrarManual} botao="Cadastrar nota" className="space-y-4">
      <label className="block">
        <span className="rotulo">Chave de acesso (44 dígitos)</span>
        <input
          value={fmtChave(chave)} onChange={(e) => digitar(e.target.value)} inputMode="numeric" autoComplete="off"
          className="campo font-mono tracking-wide" placeholder="0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000" autoFocus
        />
        <input type="hidden" name="chave" value={chave} />
        <span className="mt-1 block text-xs text-slate-500">
          {buscando ? "Lendo a chave…" : chave.length < 44 ? `${chave.length}/44 dígitos. Pode colar a chave com ou sem espaços.` : ""}
        </span>
      </label>

      {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
      {existente && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Esta chave já está cadastrada (NF {existente.numero}). <Link href={`/notas/${existente.id}`} className="font-semibold underline">Abrir a NF</Link>
        </p>
      )}
      {lido && (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
          ✓ Chave válida: {lido.modelo}, série {lido.serie}, emitida em {lido.emissao} ({lido.uf}).
          {lido.nome ? ` Empresa encontrada no ${lido.origemNome}.` : " Empresa ainda não cadastrada: digite o nome."}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label><span className="rotulo">Número da NF</span>
          <input name="numero" value={campos.numero} onChange={(e) => setCampos({ ...campos, numero: e.target.value })} className="campo" required maxLength={20} /></label>
        <label><span className="rotulo">Valor total (R$) *</span>
          <input name="valor" className="campo" required inputMode="decimal" placeholder="1.234,56" /></label>
        <label><span className="rotulo">CNPJ da empresa</span>
          <input name="cnpj" value={campos.cnpj} onChange={(e) => setCampos({ ...campos, cnpj: e.target.value })} className="campo" required maxLength={20} /></label>
        <label><span className="rotulo">Nome da empresa</span>
          <input name="nome" value={campos.nome} onChange={(e) => setCampos({ ...campos, nome: e.target.value })} className="campo" required maxLength={200} /></label>
        <label><span className="rotulo">OC</span>
          <input name="oc" className="campo" maxLength={60} placeholder={lido?.ultimaOc ? `última desta empresa: ${lido.ultimaOc}` : ""} /></label>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="sob_medida" /> Material sob medida</label>
        <label className="sm:col-span-2"><span className="rotulo">Observação</span><input name="obs" className="campo" maxLength={2000} /></label>
      </div>
      <p className="text-xs text-slate-500">
        A chave traz número, série, CNPJ, estado e mês de emissão. O valor e a OC não estão na chave e precisam ser digitados.
        Depois, se conseguir o XML ou o PDF da consulta, envie-o acima: os itens serão anexados a esta NF automaticamente.
      </p>
    </FormAcao>
  );
}
