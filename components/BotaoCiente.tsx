"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { acaoCiente } from "@/app/acoes/mencoes";

export function BotaoCiente({ id }: { id: number }) {
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  return (
    <button type="button" className="botao h-8 px-3 text-xs" disabled={pendente} onClick={() => iniciar(async () => { await acaoCiente([id]); router.refresh(); })}>
      {pendente ? "Aguarde…" : "Ciente"}
    </button>
  );
}
