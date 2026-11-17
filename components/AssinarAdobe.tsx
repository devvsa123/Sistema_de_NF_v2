"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { acaoIniciarAssinatura, acaoSituacaoAssinatura } from "@/app/acoes/assinador";

type Estado = "parado" | "abrindo" | "aguardando" | "aberto" | "enviado" | "expirado" | "erro";

/** "Assinar no Adobe": o Assistente de Assinatura abre o PDF no Adobe e devolve o assinado para a NF. */
export function AssinarAdobe({ registroId, doc, rotulo = "Assinar no Adobe", compacto = false }: { registroId: number; doc: "tav" | "checklist"; rotulo?: string; compacto?: boolean }) {
  const [estado, setEstado] = useState<Estado>("parado");
  const [msg, setMsg] = useState("");
  const [semAssistente, setSemAssistente] = useState(false);
  const sessao = useRef<number | null>(null);
  const inicio = useRef(0);
  const router = useRouter();

  useEffect(() => {
    if (!["aguardando", "aberto"].includes(estado)) return;
    const t = setInterval(async () => {
      if (!sessao.current) return;
      const s = await acaoSituacaoAssinatura(sessao.current);
      if (s.estado === "aguardando" && Date.now() - inicio.current > 12000) setSemAssistente(true);
      if (s.estado === "aberto") { setEstado("aberto"); setSemAssistente(false); setMsg(s.mensagem); }
      if (s.estado === "enviado") { setEstado("enviado"); setMsg(s.mensagem); router.refresh(); }
      if (s.estado === "expirado") { setEstado("expirado"); setMsg("O tempo para assinar acabou. Clique de novo para recomeçar."); }
    }, 3000);
    return () => clearInterval(t);
  }, [estado, router]);

  async function iniciar() {
    setEstado("abrindo"); setMsg(""); setSemAssistente(false);
    const r = await acaoIniciarAssinatura(registroId, doc);
    if ("erro" in r && r.erro) { setEstado("erro"); setMsg(r.erro); return; }
    const { id, token } = r as { id: number; token: string };
    sessao.current = id;
    inicio.current = Date.now();
    const base = `${window.location.origin}/api/assinador/${token}`;
    window.location.href = `assinanf://assinar?u=${encodeURIComponent(base)}`;
    setEstado("aguardando");
  }

  const ocupado = estado === "abrindo" || estado === "aguardando" || estado === "aberto";
  return (
    <span className={compacto ? "inline-flex flex-col" : "block space-y-2"}>
      <button type="button" onClick={iniciar} disabled={ocupado} className={compacto ? "text-left font-medium text-marinha hover:underline disabled:opacity-60" : "botao"}>
        {ocupado ? "Assinando no Adobe…" : rotulo}
      </button>
      {estado !== "parado" && (
        <span role="status" className={`block rounded-lg px-3 py-2 text-xs ${estado === "enviado" ? "bg-emerald-50 text-emerald-800" : estado === "erro" || estado === "expirado" ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-900"}`}>
          {estado === "abrindo" && "Preparando o documento…"}
          {estado === "aguardando" && "Abrindo o Assistente de Assinatura… Se o navegador perguntar, clique em Abrir."}
          {estado === "aberto" && (msg ? `Atenção: ${msg} Assine de novo no Adobe e salve.` : "Documento aberto no Adobe. Clique no campo de assinatura, assine com o token e salve. O arquivo volta sozinho para a NF.")}
          {(estado === "enviado" || estado === "erro" || estado === "expirado") && msg}
          {semAssistente && estado === "aguardando" && (
            <span className="mt-1 block">O Assistente não abriu? <a href="/assistente/AssinaNF.exe" className="font-semibold underline">Baixe e instale o Assistente de Assinatura</a> (uma vez por computador) e clique de novo.</span>
          )}
        </span>
      )}
    </span>
  );
}
