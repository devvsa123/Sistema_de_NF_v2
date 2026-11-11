"use client";

import { useState } from "react";
import { readSheet } from "read-excel-file/browser";
import { acaoImportarNotas, acaoImportarUsuarios } from "@/app/acoes/admin";
import type { Celula, Linha, ResultadoImportacao } from "@/lib/importar";

const LOTE = 40;

function paraLinhas(dados: unknown[][]): Linha[] {
  const cab = (dados[0] ?? []).map((c) => String(c ?? "").trim());
  return dados.slice(1).map((linha) => {
    const o: Linha = {};
    cab.forEach((nome, i) => {
      if (!nome) return;
      const v = linha[i];
      let c: Celula = null;
      if (v instanceof Date) c = `${String(v.getUTCDate()).padStart(2, "0")}/${String(v.getUTCMonth() + 1).padStart(2, "0")}/${v.getUTCFullYear()}`;
      else if (typeof v === "number") c = v;
      else if (typeof v === "boolean") c = v ? "TRUE" : "FALSE";
      else if (v !== null && v !== undefined) c = String(v);
      o[nome] = c;
    });
    return o;
  }).filter((o) => Object.values(o).some((v) => v !== null && v !== ""));
}

export function Importador() {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [andamento, setAndamento] = useState("");
  const [rodando, setRodando] = useState(false);
  const [resultado, setResultado] = useState<Record<string, ResultadoImportacao>>({});
  const [erro, setErro] = useState("");

  async function importar(aba: "Login" | "BancoDeDados") {
    if (!arquivo) return;
    setErro("");
    setRodando(true);
    try {
      setAndamento(`Lendo a aba ${aba}…`);
      let dados: unknown[][];
      try {
        dados = (await readSheet(arquivo, aba)) as unknown[][];
      } catch {
        throw new Error(`Não encontrei a aba "${aba}" no arquivo. Baixe a planilha inteira em Arquivo > Fazer download > Microsoft Excel (.xlsx).`);
      }
      const linhas = paraLinhas(dados);
      if (aba === "BancoDeDados") {
        // a mesma NF pode aparecer em mais de uma linha: numera as repetições para importar todas
        const vistas = new Map<string, number>();
        for (const l of linhas) {
          const k = [l["NUP"], l["Nº NOTA"], l["CNPJ"], l["VALOR DA NOTA"]].map((v) => String(v ?? "").trim()).join("|");
          vistas.set(k, (vistas.get(k) ?? 0) + 1);
          l.__rep = vistas.get(k)!;
        }
      }
      const colunaChave = aba === "Login" ? "usuario" : "Nº NOTA";
      if (!linhas.length || !(colunaChave in linhas[0])) throw new Error(`A aba "${aba}" não tem a coluna "${colunaChave}" na primeira linha.`);
      const total: ResultadoImportacao = { importadas: 0, ignoradas: 0, erros: [] };
      for (let i = 0; i < linhas.length; i += LOTE) {
        setAndamento(`Importando ${aba}: ${Math.min(i + LOTE, linhas.length)} de ${linhas.length}…`);
        const r = await (aba === "Login" ? acaoImportarUsuarios : acaoImportarNotas)(linhas.slice(i, i + LOTE));
        total.importadas += r.importadas;
        total.ignoradas += r.ignoradas;
        total.erros.push(...r.erros);
        setResultado((x) => ({ ...x, [aba]: { ...total, erros: [...total.erros] } }));
      }
      setAndamento("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao importar.");
      setAndamento("");
    }
    setRodando(false);
  }

  return (
    <div className="space-y-4">
      <div className="cartao space-y-3 p-5">
        <label className="block">
          <span className="rotulo">Arquivo .xlsx da planilha “Laboratório”</span>
          <input type="file" accept=".xlsx" className="campo" disabled={rodando} onChange={(e) => { setArquivo(e.target.files?.[0] ?? null); setResultado({}); setErro(""); }} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button className="botao" disabled={!arquivo || rodando} onClick={() => importar("Login")}>1. Importar usuários (aba Login)</button>
          <button className="botao" disabled={!arquivo || rodando} onClick={() => importar("BancoDeDados")}>2. Importar notas (aba BancoDeDados)</button>
        </div>
        {andamento && <p className="text-sm font-medium text-marinha" role="status">{andamento}</p>}
        {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{erro}</p>}
      </div>
      {Object.entries(resultado).map(([aba, r]) => (
        <div key={aba} className="cartao p-5 text-sm">
          <p className="font-semibold text-slate-800">
            {aba}: {r.importadas} importada(s) · {r.ignoradas} ignorada(s) (vazias ou já existentes) · {r.erros.length} com erro
          </p>
          {r.erros.length > 0 && (
            <ul className="mt-2 max-h-60 list-disc space-y-0.5 overflow-auto pl-5 text-red-700">
              {r.erros.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
