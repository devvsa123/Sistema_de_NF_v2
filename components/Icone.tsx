/** Ícones de traço (24×24), no estilo do restante da interface. */
const D: Record<string, string> = {
  fila: "M4 6h16M4 12h16M4 18h10",
  notas: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  novo: "M12 5v14M5 12h14",
  grafico: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  relatorio: "M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h3",
  caminho: "M5 6a2 2 0 1 0 0-.01M19 18a2 2 0 1 0 0-.01M7 6h6a4 4 0 0 1 0 8h-2a4 4 0 0 0 0 8h6",
  usuarios: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 19v-1a4 4 0 0 0-3-3.87M15.5 4.13a3 3 0 0 1 0 5.74",
  importar: "M12 3v12M7 10l5 5 5-5M4 21h16",
  manual: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M8 7h7",
  senha: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5zM12 15v2",
  sair: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11",
  menu: "M4 6h16M4 12h16M4 18h16",
  fechar: "M6 6l12 12M18 6L6 18",
};

export function Icone({ nome, className = "h-5 w-5" }: { nome: keyof typeof D | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={D[nome] ?? D.notas} />
    </svg>
  );
}
