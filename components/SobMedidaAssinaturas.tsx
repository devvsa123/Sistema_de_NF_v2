import Link from "next/link";
import type { FilaAssinaturaSobMedida } from "@/lib/documentos";
import { BotaoDocumentos } from "./DocumentosProcesso";

/**
 * NF sob medida e o certificado: para quem está na vez, o quadro "aguardando a sua assinatura" no topo da fila;
 * para o Controle, o andamento de todas (quem já assinou e quem falta), para poder cobrar.
 */
export function SobMedidaAssinaturas({ itens, modo, minhaVez }: { itens: FilaAssinaturaSobMedida[]; modo: "assinar" | "acompanhar"; minhaVez: (s: FilaAssinaturaSobMedida) => boolean }) {
  if (!itens.length) return null;
  const assinar = modo === "assinar";
  return (
    <section className={`cartao overflow-hidden ${assinar ? "border-violet-300 ring-2 ring-violet-200" : ""}`}>
      <div className={`px-4 py-3 ${assinar ? "bg-violet-50" : "bg-slate-50"}`}>
        <h2 className="text-sm font-semibold text-slate-900">
          {assinar ? `NF sob medida aguardando a sua assinatura no certificado (${itens.length})` : `NF sob medida — andamento das assinaturas do certificado (${itens.length})`}
        </h2>
        <p className="text-xs text-slate-500">
          {assinar ? "Assine pelo botão Assinar. Depois da sua assinatura, a NF sai daqui e vai para o próximo da ordem."
            : "Ordem: Estocagem → Perícia → Fiel de Suprimentos → Gestor (serviço: só a Estocagem). Em destaque, de quem é a vez."}
        </p>
      </div>
      <ul className="divide-y divide-slate-100">
        {itens.map((s) => (
          <li key={s.notaId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-sm">
                <Link href={`/notas/${s.notaId}`} className="font-semibold text-marinha hover:underline">NF {s.numero}</Link>
                <span className="ml-1.5 rounded bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Sob medida</span>
                {s.servico && <span className="ml-1.5 rounded bg-teal-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Serviço</span>}
                <span className="ml-2 text-slate-600">{s.empresa}</span>
                {s.etapa && <span className="ml-2 text-xs text-slate-400">· NF em {s.etapa}</span>}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                {s.ordem.map((o, i) => (
                  <span key={o.rotulo} className="inline-flex items-center gap-1">
                    {i > 0 && <span className="text-slate-300">→</span>}
                    <span className={`rounded px-1.5 py-0.5 font-semibold ${o.assinado ? "bg-emerald-50 text-emerald-700" : o.vez ? "bg-amber-400 text-slate-900" : "bg-slate-100 text-slate-500"}`}>
                      {o.assinado ? "✔ " : o.vez ? "✍ " : ""}{o.rotulo}
                    </span>
                  </span>
                ))}
                {!s.vez && <span className="ml-1 font-semibold text-emerald-700">· certificado assinado por todos</span>}
              </p>
            </div>
            {minhaVez(s) && <BotaoDocumentos notaId={s.notaId} numero={s.numero} total={1} rotulo="Assinar" className="botao h-8 px-3 text-xs" />}
          </li>
        ))}
      </ul>
    </section>
  );
}
