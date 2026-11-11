"use client";

import { useActionState, type ReactNode } from "react";

export type Estado = { erro?: string; ok?: string };
export type AcaoForm = (anterior: Estado, dados: FormData) => Promise<Estado>;

/** Formulário ligado a uma Server Action, com mensagem de erro/sucesso e botão com estado de envio. */
export function FormAcao({
  acao, children, botao, className = "", classeBotao = "botao", confirmar,
}: {
  acao: AcaoForm; children?: ReactNode; botao: ReactNode; className?: string; classeBotao?: string; confirmar?: string;
}) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  return (
    <form
      action={enviar}
      className={className}
      onSubmit={(e) => {
        if (confirmar && !window.confirm(confirmar)) e.preventDefault();
      }}
    >
      {children}
      {estado.erro && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{estado.erro}</p>}
      {estado.ok && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{estado.ok}</p>}
      <button type="submit" className={classeBotao} disabled={pendente}>
        {pendente ? "Aguarde…" : botao}
      </button>
    </form>
  );
}
