"use client";

export function BotaoImprimir() {
  return (
    <button type="button" className="botao-sec" onClick={() => window.print()}>
      Imprimir / PDF
    </button>
  );
}
