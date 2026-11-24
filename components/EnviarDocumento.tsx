"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { acaoConcluirEnvio, acaoEnviarParte } from "@/app/acoes/documentos";

type Tipo = { id: number; nome: string; exige: boolean; pendente: boolean };

const PARTE = 3 * 1024 * 1024;          // cada requisição fica abaixo do limite da Vercel (~4,5 MB)
const MAXIMO = 25 * 1024 * 1024;

/**
 * Envio de documentos para a NF (um ou vários arquivos do mesmo tipo). Cada arquivo sobe em partes de até 3 MB,
 * que o sistema junta, confere (tamanho, assinatura digital) e guarda: assim arquivos grandes, como laudos
 * escaneados, não esbarram no limite de envio da hospedagem.
 */
export function EnviarDocumento({ id, tipos }: { id: number; tipos: Tipo[] }) {
  const inicial = tipos.find((t) => t.pendente)?.id ?? "";
  const [tipo, setTipo] = useState<number | "">(inicial);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState("");
  const [ok, setOk] = useState<string[]>([]);
  const [erros, setErros] = useState<string[]>([]);
  const [chave, setChave] = useState(0);
  const router = useRouter();
  const escolhido = tipos.find((t) => t.id === tipo);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!arquivos.length) return;
    setEnviando(true); setOk([]); setErros([]);
    const feitos: string[] = [], falhas: string[] = [];
    for (const [k, a] of arquivos.entries()) {
      if (a.size > MAXIMO) { falhas.push(`${a.name}: tem ${(a.size / 1048576).toFixed(1)} MB; o limite é 25 MB. Reduza o PDF e envie de novo.`); continue; }
      if (!a.size) { falhas.push(`${a.name}: o arquivo está vazio.`); continue; }
      const envio = crypto.randomUUID();
      const total = Math.max(1, Math.ceil(a.size / PARTE));
      let falhou = "";
      for (let p = 0; p < total && !falhou; p++) {
        setProgresso(`${arquivos.length > 1 ? `Arquivo ${k + 1} de ${arquivos.length} · ` : ""}${a.name}: enviando ${total > 1 ? `parte ${p + 1} de ${total}` : ""}…`);
        const f = new FormData();
        f.set("nota", String(id)); f.set("envio", envio); f.set("parte", String(p));
        f.set("dados", a.slice(p * PARTE, Math.min(a.size, (p + 1) * PARTE)));
        try {
          const r = await acaoEnviarParte(f);
          if (r.erro) falhou = r.erro;
        } catch {
          falhou = "a conexão caiu durante o envio. Tente de novo.";
        }
      }
      if (falhou) { falhas.push(`${a.name}: ${falhou}`); continue; }
      setProgresso(`${a.name}: conferindo e guardando…`);
      try {
        const r = await acaoConcluirEnvio({ envio, nota: id, tipo: Number(tipo) || 0, nome: a.name, mime: a.type, total, tamanho: a.size });
        if (r.erro) falhas.push(r.erro); else if (r.ok) feitos.push(r.ok);
      } catch {
        falhas.push(`${a.name}: não foi possível concluir o envio. Tente de novo.`);
      }
    }
    setEnviando(false); setProgresso(""); setOk(feitos); setErros(falhas);
    if (feitos.length) { setArquivos([]); setChave((c) => c + 1); router.refresh(); }
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[18rem_1fr]">
        <label>
          <span className="rotulo">Tipo do documento</span>
          <select name="tipo" className="campo" value={tipo} onChange={(e) => setTipo(Number(e.target.value) || "")} disabled={enviando}>
            <option value="">Identificar pelo arquivo (TAV e Check-list do sistema)</option>
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}{t.exige ? " (assinado)" : ""}{t.pendente ? " — pendente" : ""}</option>)}
          </select>
        </label>
        <label>
          <span className="rotulo">Arquivo{escolhido?.exige ? " (PDF assinado digitalmente)" : " (PDF, JPG, PNG ou XML, até 25 MB)"}</span>
          <input key={chave} type="file" name="arquivo" required multiple disabled={enviando} accept=".pdf,.jpg,.jpeg,.png,.xml,application/pdf,image/*" className="campo pt-1.5"
            onChange={(e) => setArquivos(Array.from(e.target.files ?? []))} />
        </label>
      </div>
      {erros.map((m) => <p key={m} role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{m}</p>)}
      {ok.length > 0 && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok.join(" · ")}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="botao" disabled={enviando || !arquivos.length}>{enviando ? "Enviando…" : "Anexar à NF"}</button>
        {progresso && <span className="text-xs text-slate-600">{progresso}</span>}
      </div>
    </form>
  );
}
