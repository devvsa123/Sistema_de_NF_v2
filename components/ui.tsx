import Link from "next/link";
import type { ReactNode } from "react";
import { farol, situacao } from "@/lib/format";

const CORES_STATUS: Record<string, string> = {
  em_tramite: "bg-blue-50 text-blue-800 ring-blue-200",
  reprovada: "bg-red-50 text-red-700 ring-red-200",
  finalizada: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  retirada: "bg-amber-50 text-amber-800 ring-amber-200",
  arquivada: "bg-slate-100 text-slate-600 ring-slate-200",
};

export function Selo({ nota, paraEmpresa = false }: { nota: { status: string; etapa_nome?: string | null }; paraEmpresa?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${CORES_STATUS[nota.status] ?? ""}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {situacao(nota, paraEmpresa)}
    </span>
  );
}

const CORES_FAROL = { verde: "bg-emerald-500", amarelo: "bg-amber-400", vermelho: "bg-red-500" };
const NOME_FAROL = { verde: "Dentro do prazo", amarelo: "Próximo do prazo", vermelho: "Prazo estourado" };

export function Farol({ dias, prazo }: { dias: number; prazo: number }) {
  const f = farol(dias, prazo);
  return <span title={`${NOME_FAROL[f]} (prazo: ${prazo} dias)`} className={`inline-block h-2.5 w-2.5 rounded-full ${CORES_FAROL[f]}`} />;
}

export function Indicador({ titulo, valor, detalhe, cor = "text-slate-900" }: { titulo: string; valor: ReactNode; detalhe?: ReactNode; cor?: string }) {
  return (
    <div className="cartao px-5 py-4">
      <p className="text-[13px] font-medium text-slate-500">{titulo}</p>
      <p className={`mt-1.5 text-[26px] font-semibold leading-tight tracking-tight tabular-nums ${cor}`}>{valor}</p>
      {detalhe && <p className="mt-1 text-xs text-slate-500">{detalhe}</p>}
    </div>
  );
}

/** Cabeçalho padrão das páginas: título, descrição e ações à direita. */
export function Cabecalho({ titulo, descricao, children }: { titulo: ReactNode; descricao?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
      <div className="min-w-0">
        <h1 className="titulo">{titulo}</h1>
        {descricao && <p className="subtitulo max-w-3xl">{descricao}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="cartao border-dashed px-6 py-12 text-center text-sm text-slate-500">{children}</div>;
}

export function Voltar({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-sm font-medium text-marinha hover:underline">
      ← {children}
    </Link>
  );
}
