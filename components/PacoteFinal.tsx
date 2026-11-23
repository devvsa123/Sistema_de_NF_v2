"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { zipSync } from "fflate";
import { acaoConfirmarPacote, acaoVerificarPacote } from "@/app/acoes/pacote";
import { acaoTramitar } from "@/app/acoes/notas";
import type { ArquivoPacote } from "@/lib/pacote";
import { dataHora } from "@/lib/format";

/**
 * Pacote final da NF (última etapa): baixa todos os documentos assinados e o histórico da NF num ZIP,
 * confere cada arquivo pelo SHA-256 (o mesmo registrado no sistema) e pede a confirmação de quem baixou.
 * Só depois a NF pode ser finalizada; ao finalizar, os arquivos são excluídos do sistema.
 */

type Verif = { arquivos: ArquivoPacote[]; pendencias: string[]; conferido: { em: Date; por: string } | null };
type Baixado = { recebidos: { id: number; sha256: string }[]; historicoSha: string; nomeZip: string };

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const seguro = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\- ()]+/g, "_").replace(/\s+/g, " ").trim();

export function PacoteFinal({ notaId, numero, empresa }: { notaId: number; numero: string; empresa: string }) {
  const [v, setV] = useState<Verif | null>(null);
  const [erro, setErro] = useState("");
  const [etapa, setEtapa] = useState<"" | "baixando" | "confirmando" | "finalizando">("");
  const [progresso, setProgresso] = useState("");
  const [baixado, setBaixado] = useState<Baixado | null>(null);
  const [conferi, setConferi] = useState(false);
  const router = useRouter();

  const carregar = useCallback(async () => {
    const r = await acaoVerificarPacote(notaId);
    if ("erro" in r && r.erro) { setErro(r.erro); return; }
    setErro(""); setV(r as Verif);
  }, [notaId]);
  useEffect(() => { const t = setTimeout(carregar, 0); return () => clearTimeout(t); }, [carregar]);

  async function baixar() {
    if (!v) return;
    setEtapa("baixando"); setErro("");
    try {
      const pasta = seguro(`NF ${numero} - ${empresa}`).slice(0, 80);
      const arquivos: Record<string, Uint8Array> = {};
      const recebidos: Baixado["recebidos"] = [];
      const linhas: string[] = [];
      const usados = new Set<string>();
      for (const [i, a] of v.arquivos.entries()) {
        setProgresso(`Baixando ${i + 1} de ${v.arquivos.length}: ${a.nome}`);
        const resp = await fetch(`/api/documentos/${a.id}?baixar`, { cache: "no-store" });
        if (!resp.ok) throw new Error(`Não foi possível baixar ${a.nome}: ${await resp.text()}`);
        const bytes = new Uint8Array(await resp.arrayBuffer());
        const sha = hex(await crypto.subtle.digest("SHA-256", bytes));
        if (sha !== a.sha256) throw new Error(`O arquivo ${a.nome} chegou diferente do que está no sistema (SHA-256 não confere). Tente de novo.`);
        let nome = seguro(`${String(i + 1).padStart(2, "0")} - ${a.tipo} - ${a.nome}`);
        while (usados.has(nome)) nome = `_${nome}`;
        usados.add(nome);
        arquivos[`${pasta}/${nome}`] = bytes;
        recebidos.push({ id: a.id, sha256: sha });
        linhas.push(`${nome}\n  SHA-256: ${sha}\n  Assinado por: ${a.assinaturas.join(", ") || "-"}`);
      }
      setProgresso("Gerando o histórico da NF…");
      const h = await fetch(`/api/notas/${notaId}/historico`, { cache: "no-store" });
      if (!h.ok) throw new Error(`Não foi possível gerar o histórico: ${await h.text()}`);
      const hist = new Uint8Array(await h.arrayBuffer());
      const historicoSha = hex(await crypto.subtle.digest("SHA-256", hist));
      arquivos[`${pasta}/00 - Historico da NF ${seguro(numero)}.pdf`] = hist;
      linhas.unshift(`00 - Historico da NF ${seguro(numero)}.pdf\n  SHA-256: ${historicoSha}`);
      const manifesto = `PACOTE FINAL DA NF ${numero} - ${empresa}\nGerado em ${new Date().toLocaleString("pt-BR")}\n\n`
        + `Cada arquivo foi conferido pelo SHA-256 registrado no Sistema de Tramitação de NF.\n\n${linhas.join("\n\n")}\n`;
      arquivos[`${pasta}/LEIA-ME - conferencia dos arquivos.txt`] = new TextEncoder().encode(manifesto);
      setProgresso("Montando o arquivo ZIP…");
      const zip = zipSync(arquivos, { level: 0 });
      const nomeZip = `${pasta}.zip`;
      const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url; link.download = nomeZip;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setBaixado({ recebidos, historicoSha, nomeZip });
      setConferi(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao montar o pacote.");
    } finally {
      setEtapa(""); setProgresso("");
    }
  }

  async function confirmar() {
    if (!baixado) return;
    setEtapa("confirmando"); setErro("");
    const r = await acaoConfirmarPacote(notaId, baixado.recebidos, baixado.historicoSha);
    setEtapa("");
    if ("erro" in r && r.erro) { setErro(r.erro); return; }
    setBaixado(null);
    await carregar();
    router.refresh();
  }

  async function finalizar() {
    if (!window.confirm(`Finalizar a NF ${numero}? Os arquivos dos documentos serão excluídos do sistema (ficam no pacote que você baixou). O histórico da NF continua no sistema.`)) return;
    setEtapa("finalizando"); setErro("");
    const r = await acaoTramitar([notaId], "avancar");
    setEtapa("");
    if (r.erros.length) { setErro(r.erros.join(" ")); return; }
    router.refresh();
  }

  return (
    <section className="cartao border-l-4 border-l-marinha p-5" id="pacote-final">
      <h2 className="text-[15px] font-semibold text-slate-900">Pacote final da NF</h2>
      <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-slate-500">
        Para finalizar, baixe o pacote com todos os documentos assinados e o histórico da NF (para os autos do processo de pagamento), confira e confirme.
        Ao finalizar, os arquivos são excluídos do sistema; o histórico e os dados da NF continuam aqui.
      </p>

      {!v && !erro && <p className="mt-3 text-sm text-slate-500">Conferindo os documentos e as assinaturas…</p>}

      {v && (
        <div className="mt-4 space-y-4">
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
            {v.arquivos.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                <span><span className="font-medium text-slate-800">{a.tipo}</span> <span className="text-xs text-slate-500">{a.nome}</span></span>
                <span className="text-xs text-emerald-700">{a.assinaturas.length ? `✔ ${a.assinaturas.join(", ")}` : <span className="text-slate-500">sem assinatura (não exigida)</span>}</span>
              </li>
            ))}
            <li className="px-3 py-2 text-xs text-slate-500">+ Histórico da NF em PDF (gerado na hora) e a lista de conferência dos arquivos.</li>
          </ul>

          {v.pendencias.length > 0 ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <p className="font-semibold">Resolva antes de baixar o pacote:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">{v.pendencias.map((p) => <li key={p}>{p}</li>)}</ul>
              <button type="button" className="mt-2 text-xs font-medium underline" onClick={carregar}>Conferir de novo</button>
            </div>
          ) : v.conferido ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
              <p className="text-sm text-emerald-900">✔ Pacote baixado e conferido por <strong>{v.conferido.por}</strong> em {dataHora(v.conferido.em)}. A NF pode ser finalizada.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="botao-sec h-9 text-sm" disabled={!!etapa} onClick={baixar}>Baixar de novo</button>
                <button type="button" className="botao h-9 text-sm" disabled={!!etapa} onClick={finalizar}>{etapa === "finalizando" ? "Finalizando…" : "Finalizar NF"}</button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-marinha text-xs font-bold text-white">1</span>
                <button type="button" className="botao" disabled={!!etapa} onClick={baixar}>{etapa === "baixando" ? "Baixando…" : baixado ? "Baixar o pacote de novo" : `Baixar pacote (${v.arquivos.length + 1} arquivos, ZIP)`}</button>
                {progresso && <span className="text-xs text-slate-600">{progresso}</span>}
              </div>
              {baixado && (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                  <p className="text-emerald-800">✔ <strong>{baixado.nomeZip}</strong> baixado: {baixado.recebidos.length} documento(s) + histórico, cada um conferido pelo SHA-256 do sistema.</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-marinha text-xs font-bold text-white">2</span>
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-1" checked={conferi} onChange={(e) => setConferi(e.target.checked)} />
                      <span>Abri o arquivo ZIP no computador, os documentos abrem normalmente e estão completos e assinados. Guardei o pacote para o processo de pagamento.</span>
                    </label>
                  </div>
                  <button type="button" className="botao" disabled={!conferi || !!etapa} onClick={confirmar}>{etapa === "confirmando" ? "Registrando…" : "Confirmar conferência"}</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {erro && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
    </section>
  );
}
