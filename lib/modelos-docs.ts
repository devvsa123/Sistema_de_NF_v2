import "server-only";
import { MARCADORES } from "./laudo";
import { MARCADORES_CHECKLIST, MARCADORES_TAV } from "./recebimento";

/** Documentos gerados pelo sistema a partir de modelos editáveis. */
export const DOCUMENTOS = {
  laudo_pericial: { nome: "Laudo pericial", quem: "Perícia", marcadores: MARCADORES },
  tav: { nome: "TAV — Termo de Abertura de Volumes", quem: "Recebimento", marcadores: MARCADORES_TAV },
  checklist: { nome: "Check-list de Recebimento", quem: "Recebimento", marcadores: MARCADORES_CHECKLIST },
} as const;

export type ChaveDoc = keyof typeof DOCUMENTOS;
export const ehDoc = (v: unknown): v is ChaveDoc => typeof v === "string" && v in DOCUMENTOS;
