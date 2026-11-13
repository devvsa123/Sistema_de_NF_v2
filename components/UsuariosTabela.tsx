"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type LinhaUsuario = {
  id: number; nome: string; login: string; loginFmt: string; papel: string; papelNome: string; setores: string[];
  permissoes: string; gestor: boolean; ativo: boolean; situacao: string; editavel: boolean;
};

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function UsuariosTabela({ linhas, perfis, setores }: { linhas: LinhaUsuario[]; perfis: [string, string][]; setores: string[] }) {
  const [q, setQ] = useState("");
  const [papel, setPapel] = useState("");
  const [setor, setSetor] = useState("");
  const [situacao, setSituacao] = useState("ativos");

  const visiveis = useMemo(() => {
    const termos = sem(q).split(/\s+/).filter(Boolean);
    return linhas.filter((u) => {
      if (papel === "gestor" ? !u.gestor : papel && u.papel !== papel) return false;
      if (setor && !u.setores.includes(setor)) return false;
      if (situacao === "ativos" && !u.ativo) return false;
      if (situacao === "inativos" && u.ativo) return false;
      const alvo = sem(`${u.nome} ${u.login} ${u.loginFmt}`);
      return termos.every((t) => alvo.includes(t) || (/\d/.test(t) && u.login.includes(t.replace(/\D/g, ""))));
    });
  }, [linhas, q, papel, setor, situacao]);

  return (
    <div className="space-y-4">
      <div className="cartao grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
        <label>
          <span className="rotulo">Pesquisar</span>
          <input className="campo" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, NIP ou CNPJ" autoFocus />
        </label>
        <label>
          <span className="rotulo">Perfil</span>
          <select className="campo" value={papel} onChange={(e) => setPapel(e.target.value)}>
            <option value="">Todos</option>
            {perfis.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            <option value="gestor">Administradores de usuários</option>
          </select>
        </label>
        <label>
          <span className="rotulo">Setor</span>
          <select className="campo" value={setor} onChange={(e) => setSetor(e.target.value)}>
            <option value="">Todos</option>
            {setores.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label>
          <span className="rotulo">Situação</span>
          <select className="campo" value={situacao} onChange={(e) => setSituacao(e.target.value)}>
            <option value="ativos">Ativos</option><option value="inativos">Inativos</option><option value="">Todos</option>
          </select>
        </label>
      </div>
      <p className="text-sm text-slate-500">{visiveis.length} de {linhas.length} usuário(s)</p>
      <div className="cartao overflow-x-auto">
        <table className="tabela">
          <thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Setores e permissões</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            {visiveis.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-slate-500">Nenhum usuário encontrado.</td></tr>}
            {visiveis.map((u) => (
              <tr key={u.id} className={u.ativo ? "" : "opacity-60"}>
                <td className="font-medium text-slate-900">{u.nome}</td>
                <td className="whitespace-nowrap font-mono text-xs">{u.loginFmt}</td>
                <td className="whitespace-nowrap">{u.papelNome}</td>
                <td className="text-xs text-slate-600">
                  {u.permissoes}
                  {u.gestor && <span className="ml-1 inline-flex rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-inset ring-violet-200">Administrador de usuários</span>}
                </td>
                <td className="whitespace-nowrap text-xs">{u.situacao}</td>
                <td className="whitespace-nowrap text-right">
                  {u.editavel ? <Link href={`/admin/usuarios/${u.id}`} className="font-medium text-marinha hover:underline">Editar</Link>
                    : <span className="text-xs text-slate-400">só o administrador geral</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
