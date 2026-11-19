"use client";

import Link from "next/link";
import { useState } from "react";
import { acaoAnalisarDocumento, acaoCadastrarDocumento } from "@/app/acoes/notas";
import { cnpj, data, moeda } from "@/lib/format";
import { descreverMotivo, NOME_TIPO_NF, type TipoNF } from "@/lib/tipo-nf";

type Previa = {
  chave: string; numero: string; serie: string; emit_cnpj: string; emit_nome: string; valor: number; data_emissao: string | null;
  oc: string; empenho: string; itens: number; existente: { id: number; tem_xml: boolean; fonte: string | null; oc: string | null } | null; bloqueio: string | null;
  tipo: TipoNF; motivo: string;
};
type Item = {
  arquivo: string; tipo: "xml" | "pdf"; conteudo: string; previa?: Previa; erro?: string; oc: string; sobMedida: boolean;
  tipoNf: TipoNF; danfe: { nome: string; conteudo: string } | null; aviso?: string;
  estado: "pronto" | "enviando" | "ok" | "erro"; id?: number; anexado?: boolean;
};
const LIMITE_DANFE = 3 * 1024 * 1024;

const LIMITE = 2 * 1024 * 1024;

async function emBase64(a: File) {
  const bytes = new Uint8Array(await a.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function EnvioXml() {
  const [itens, setItens] = useState<Item[]>([]);
  const [lendo, setLendo] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const mudar = (i: number, p: Partial<Item>) => setItens((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));

  async function escolher(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    setLendo(true);
    const novos: Item[] = [];
    for (const a of Array.from(arquivos).slice(0, 50)) {
      const tipo = /\.pdf$/i.test(a.name) || a.type === "application/pdf" ? "pdf" : "xml";
      const base: Item = { arquivo: a.name, tipo, conteudo: "", oc: "", sobMedida: false, tipoNf: "material", danfe: null, estado: "erro" };
      if (a.size > LIMITE) { novos.push({ ...base, erro: "Arquivo maior que 2 MB." }); continue; }
      const conteudo = tipo === "pdf" ? await emBase64(a) : await a.text();
      const r = await acaoAnalisarDocumento(tipo, conteudo);
      if (r.erro || !r.previa) novos.push({ ...base, erro: r.erro ?? "Não foi possível ler o arquivo." });
      else if (r.previa.bloqueio) novos.push({ ...base, previa: r.previa, erro: r.previa.bloqueio, id: r.previa.existente?.id });
      else novos.push({ ...base, conteudo, previa: r.previa, oc: r.previa.oc || r.previa.existente?.oc || "", tipoNf: r.previa.tipo, estado: "pronto" });
    }
    setItens((l) => [...l.filter((x) => x.estado !== "erro" || x.previa), ...novos]);
    setLendo(false);
  }

  async function cadastrar() {
    setEnviando(true);
    for (let i = 0; i < itens.length; i++) {
      const it = itens[i];
      if (it.estado !== "pronto") continue;
      mudar(i, { estado: "enviando" });
      const r = await acaoCadastrarDocumento(it.tipo, it.conteudo, { oc: it.oc, sobMedida: it.sobMedida, tipoNf: it.tipoNf, danfe: it.danfe });
      if (r.ok) mudar(i, { estado: "ok", id: r.ok.id, anexado: r.ok.anexado, aviso: r.ok.aviso });
      else mudar(i, { estado: "erro", erro: r.erro });
    }
    setEnviando(false);
  }

  async function escolherDanfe(i: number, a: File | undefined) {
    if (!a) return;
    if (!/\.pdf$/i.test(a.name) && a.type !== "application/pdf") { mudar(i, { aviso: "O PDF da DANFE precisa ser um arquivo PDF." }); return; }
    if (a.size > LIMITE_DANFE) { mudar(i, { aviso: "O PDF da DANFE tem mais de 3 MB. Reduza o tamanho e escolha de novo." }); return; }
    mudar(i, { danfe: { nome: a.name, conteudo: await emBase64(a) }, aviso: undefined });
  }

  const prontos = itens.filter((i) => i.estado === "pronto").length;
  const semOc = itens.filter((i) => i.estado === "pronto" && !i.oc.trim()).length;

  return (
    <div className="space-y-4">
      <label
        className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white px-6 py-10 text-center transition hover:border-marinha hover:bg-blue-50/40"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); escolher(e.dataTransfer.files); }}
      >
        <span className="text-base font-semibold text-slate-700">{lendo ? "Lendo arquivos…" : "Clique ou arraste aqui os arquivos das NF-e (XML ou PDF da consulta na SEFAZ)"}</span>
        <span className="mt-1 text-sm text-slate-500">Pode enviar vários de uma vez. Os dados da nota são preenchidos automaticamente.</span>
        <input type="file" accept=".xml,.pdf,text/xml,application/xml,application/pdf" multiple className="hidden" disabled={lendo || enviando}
          onChange={(e) => { escolher(e.target.files); e.target.value = ""; }} />
      </label>

      {itens.map((it, i) => (
        <div key={i} className={`cartao p-4 ${it.estado === "ok" ? "border-emerald-300 bg-emerald-50/40" : it.estado === "erro" ? "border-red-200" : ""}`}>
          {it.previa ? (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-800">
                  NF {it.previa.numero} <span className="font-normal text-slate-400">/ série {it.previa.serie}</span> · {moeda(it.previa.valor)}
                </p>
                <p className="text-sm text-slate-600">{it.previa.emit_nome} · {cnpj(it.previa.emit_cnpj)}</p>
                <p className="text-xs text-slate-400">
                  Emissão {data(it.previa.data_emissao)} · {it.previa.itens} item(ns){it.previa.empenho ? ` · Empenho ${it.previa.empenho}` : ""} · {it.arquivo}
                </p>
                {!it.previa.oc && !it.previa.existente?.oc && it.estado === "pronto" && (
                  <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800">
                    Esta NF não informa o número da OC nos dados adicionais. Digite a OC ao lado para poder cadastrar.
                  </p>
                )}
                {it.previa.existente && it.estado === "pronto" && (
                  <p className="mt-1 text-xs font-medium text-amber-700">NF já cadastrada — os dados deste arquivo serão anexados a ela, sem alterar a tramitação.</p>
                )}
                {(it.estado === "pronto" || it.estado === "enviando") && (
                  <div className="mt-2 space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-slate-600">Tipo da NF:</span>
                      {(["material", "servico"] as const).map((t) => (
                        <label key={t} className={`cursor-pointer rounded-md border px-2 py-0.5 font-semibold ${it.tipoNf === t ? (t === "servico" ? "border-teal-600 bg-teal-600 text-white" : "border-marinha bg-marinha text-white") : "border-slate-300 bg-white text-slate-700"}`}>
                          <input type="radio" className="sr-only" checked={it.tipoNf === t} onChange={() => mudar(i, { tipoNf: t })} disabled={enviando} />{NOME_TIPO_NF[t]}
                        </label>
                      ))}
                      <span className="text-slate-500">{it.tipoNf === it.previa.tipo ? descreverMotivo(it.previa.motivo) : "Alterado manualmente"}</span>
                    </div>
                    <p className="text-slate-500">Certificado que vai junto com o PDF da NF: <strong className="text-slate-700">{it.tipoNf === "servico" ? "Prestação de Serviços (assinatura só da Estocagem)" : "Recebimento de Bens"}</strong></p>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="botao-sec h-7 cursor-pointer px-2.5 text-xs">
                        {it.danfe ? "Trocar PDF da DANFE" : "Anexar PDF da DANFE"}
                        <input type="file" accept=".pdf,application/pdf" className="hidden" disabled={enviando} onChange={(e) => { escolherDanfe(i, e.target.files?.[0]); e.target.value = ""; }} />
                      </label>
                      {it.danfe ? <span className="text-emerald-700">✓ {it.danfe.nome} <button type="button" className="ml-1 text-slate-500 underline" onClick={() => mudar(i, { danfe: null })} disabled={enviando}>remover</button></span>
                        : <span className="text-slate-500">opcional: o sistema acrescenta o certificado ao PDF e anexa na NF</span>}
                    </div>
                    {it.aviso && <p className="font-medium text-amber-800">{it.aviso}</p>}
                  </div>
                )}
                {it.estado === "ok" && it.aviso && <p className="mt-1 text-xs font-medium text-amber-800">{it.aviso}</p>}
              </div>
              {it.estado === "pronto" || it.estado === "enviando" ? (
                <div className="flex flex-wrap items-end gap-3">
                  <label>
                    <span className="rotulo">OC *</span>
                    <input className={`campo w-36 ${!it.oc.trim() ? "!border-amber-400 bg-amber-50 ring-4 ring-amber-100" : ""}`} value={it.oc} maxLength={60}
                      inputMode="numeric" placeholder="Digite a OC" onChange={(e) => mudar(i, { oc: e.target.value })} disabled={enviando} aria-invalid={!it.oc.trim()} />
                    <span className={`mt-1 block text-[11px] ${it.previa.oc ? "text-emerald-700" : "text-amber-700"}`}>
                      {it.previa.oc ? (it.oc === it.previa.oc ? "✓ identificada na NF" : `na NF: ${it.previa.oc}`) : it.previa.existente?.oc ? "OC já cadastrada" : "não consta na NF"}
                    </span>
                  </label>
                  {!it.previa.existente && (
                    <label className="flex items-center gap-2 pb-2 text-sm">
                      <input type="checkbox" checked={it.sobMedida} onChange={(e) => mudar(i, { sobMedida: e.target.checked })} disabled={enviando} /> Sob medida
                    </label>
                  )}
                  <button className="botao-sec" onClick={() => setItens((l) => l.filter((_, j) => j !== i))} disabled={enviando}>Remover</button>
                </div>
              ) : it.estado === "ok" ? (
                <Link href={`/notas/${it.id}`} className="text-sm font-semibold text-emerald-700 hover:underline">
                  ✓ {it.anexado ? "Dados anexados" : "Cadastrada"} — abrir
                </Link>
              ) : (
                <span className="text-sm text-red-700">{it.erro} {it.id && <Link href={`/notas/${it.id}`} className="underline">Abrir</Link>}</span>
              )}
            </div>
          ) : (
            <p className="text-sm text-red-700"><strong>{it.arquivo}:</strong> {it.erro}</p>
          )}
        </div>
      ))}

      {prontos > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <button className="botao" onClick={cadastrar} disabled={enviando || semOc > 0}>
            {enviando ? "Cadastrando…" : `Cadastrar ${prontos} nota(s)`}
          </button>
          {semOc > 0 && <span className="text-sm font-medium text-amber-800">Falta a OC em {semOc} nota(s). Digite para continuar.</span>}
        </div>
      )}
    </div>
  );
}
