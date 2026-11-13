"use client";

import { useState } from "react";
import { FormAcao } from "./FormAcao";
import { Marcar } from "./Marcar";
import { acaoObservacao } from "@/app/acoes/notas";

/** "Nova observação" da página da NF, com marcação de pessoas e setores. */
export function FormObservacao({ id }: { id: number }) {
  const [marcados, setMarcados] = useState<string[]>([]);
  return (
    <FormAcao acao={acaoObservacao} botao={marcados.length ? "Registrar e avisar" : "Registrar"} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <textarea name="texto" className="campo" rows={3} maxLength={2000} required placeholder="Escreva a observação, dúvida ou problema" />
      <Marcar valor={marcados} onChange={setMarcados} nomeCampo="marcados" />
      <p className="text-xs text-slate-500">Marque uma pessoa ou um setor para que recebam um aviso em destaque no sistema.</p>
    </FormAcao>
  );
}
