"use client";

import { useState } from "react";
import { FormAcao } from "./FormAcao";
import { acaoEnviarDocumento } from "@/app/acoes/documentos";

type Tipo = { id: number; nome: string; exige: boolean; pendente: boolean };

/** Envio de documentos para a NF (um ou vários arquivos do mesmo tipo). */
export function EnviarDocumento({ id, tipos }: { id: number; tipos: Tipo[] }) {
  const inicial = tipos.find((t) => t.pendente)?.id ?? "";
  const [tipo, setTipo] = useState<number | "">(inicial);
  const escolhido = tipos.find((t) => t.id === tipo);
  return (
    <FormAcao acao={acaoEnviarDocumento} botao="Anexar à NF" className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-3 sm:grid-cols-[18rem_1fr]">
      <label>
        <span className="rotulo">Tipo do documento</span>
        <select name="tipo" required className="campo" value={tipo} onChange={(e) => setTipo(Number(e.target.value) || "")}>
          <option value="">Selecione…</option>
          {tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}{t.exige ? " (assinado)" : ""}{t.pendente ? " — pendente" : ""}</option>)}
        </select>
      </label>
      <label>
        <span className="rotulo">Arquivo{escolhido?.exige ? " (PDF assinado digitalmente)" : " (PDF, JPG, PNG ou XML, até 4 MB)"}</span>
        <input type="file" name="arquivo" required multiple accept=".pdf,.jpg,.jpeg,.png,.xml,application/pdf,image/*" className="campo pt-1.5" />
      </label>
      </div>
    </FormAcao>
  );
}
