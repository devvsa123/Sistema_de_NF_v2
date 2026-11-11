// Funções de formatação usadas no servidor e no navegador
const TZ = "America/Sao_Paulo";

export const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

export function moeda(v: number | string | null | undefined) {
  const n = Number(v ?? 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function numero(v: number | string | null | undefined, casas = 0) {
  return Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

export function data(v: Date | string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("pt-BR", { timeZone: TZ });
}

export function dataHora(v: Date | string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleString("pt-BR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
}

export function cnpj(v: string | null | undefined) {
  const d = soDigitos(v);
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return v || "—";
}

export function login(v: string) {
  const d = soDigitos(v);
  if (d.length === 14) return cnpj(d);
  if (d.length === 8) return `${d.slice(0, 2)}.${d.slice(2, 6)}.${d.slice(6)}`;
  return v;
}

export function dias(v: number | string | null | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (n < 1) return "< 1 dia";
  const r = Math.round(n * 10) / 10;
  return `${r.toLocaleString("pt-BR")} ${r === 1 ? "dia" : "dias"}`;
}

export const STATUS_NOME: Record<string, string> = {
  em_tramite: "Em trâmite",
  reprovada: "Reprovada",
  finalizada: "Finalizada",
  retirada: "Retirada pelo fornecedor",
  arquivada: "Arquivada",
};

/** Situação exibida: nome da etapa quando em trâmite, senão o status. */
export function situacao(n: { status: string; etapa_nome?: string | null }, paraEmpresa = false) {
  if (n.status === "em_tramite") return n.etapa_nome || "Em trâmite";
  if (n.status === "finalizada" && paraEmpresa) return "Enviada para o COMRJ";
  return STATUS_NOME[n.status] ?? n.status;
}

/** Semáforo do prazo: verde, amarelo (>70% do prazo) ou vermelho (estourado). */
export function farol(diasNaEtapa: number, prazo: number): "verde" | "amarelo" | "vermelho" {
  if (diasNaEtapa > prazo) return "vermelho";
  if (diasNaEtapa > prazo * 0.7) return "amarelo";
  return "verde";
}

export function mesAtual() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: TZ }).slice(0, 7);
}

export function nomeMes(ym: string) {
  const [a, m] = ym.split("-").map(Number);
  const s = new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
