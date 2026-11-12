import { Cabecalho } from "@/components/ui";
import Link from "next/link";
import { exigirGestorUsuarios } from "@/lib/auth";
import { sql } from "@/lib/db";
import { login } from "@/lib/format";

export const metadata = { title: "Usuários — Administração" };

const PAPEL: Record<string, string> = { admin: "Administrador geral", interno: "Interno", consulta: "Consulta (vê tudo)", empresa: "Fornecedor" };

export default async function Usuarios({ searchParams }: PageProps<"/admin/usuarios">) {
  const quem = await exigirGestorUsuarios();
  const geral = quem.papel === "admin";
  const papel = String((await searchParams).papel ?? "");
  const usuarios = await sql`
    select u.id, u.login, u.nome, u.papel, u.ativo, u.pode_cadastrar, u.trata_reprovadas, u.gerencia_usuarios, u.deve_trocar_senha,
           (select string_agg(e.nome, ', ' order by e.ordem) from usuario_etapas ue join etapas e on e.id = ue.etapa_id and e.ativo where ue.usuario_id = u.id) as etapas
    from usuarios u where ${papel ? sql`u.papel = ${papel}` : sql`true`} order by u.ativo desc, u.papel = 'empresa', u.nome`;
  return (
    <div className="space-y-4">
      <Cabecalho titulo="Usuários" descricao="Quem acessa o sistema, com qual perfil e em quais etapas pode tramitar.">
        <Link href="/admin/usuarios/novo" className="botao">+ Novo usuário</Link>
      </Cabecalho>
      <div className="flex flex-wrap gap-1.5 text-sm">
        {[["", "Todos"], ...Object.entries(PAPEL)].map(([k, v]) => (
          <Link key={k} href={k ? `/admin/usuarios?papel=${k}` : "/admin/usuarios"}
            className={`rounded-full px-3 py-1 font-medium ring-1 ring-inset ${papel === k ? "bg-marinha text-white ring-marinha" : "bg-white text-slate-700 ring-slate-300"}`}>
            {v}
          </Link>
        ))}
      </div>
      <div className="cartao overflow-x-auto">
        <table className="tabela">
          <thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Permissões</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id} className={u.ativo ? "" : "opacity-50"}>
                <td className="font-medium">{u.nome}</td>
                <td className="whitespace-nowrap font-mono text-xs">{login(u.login)}</td>
                <td>{PAPEL[u.papel]}</td>
                <td className="text-xs text-slate-600">
                  {u.papel === "interno" && [u.etapas, u.pode_cadastrar && "Cadastra NF", u.trata_reprovadas && "Trata reprovadas"].filter(Boolean).join(" · ")}
                  {u.gerencia_usuarios && <span className="ml-1 inline-flex rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-inset ring-violet-200">Administrador de usuários</span>}
                  {u.papel === "empresa" && "Somente as NF do próprio CNPJ"}
                  {u.papel === "admin" && "Acesso total"}
                  {u.papel === "consulta" && "Consulta todas as NF e relatórios"}
                </td>
                <td className="text-xs">{u.ativo ? (u.deve_trocar_senha ? "Ativo · troca de senha pendente" : "Ativo") : "Inativo"}</td>
                <td>{geral || (u.papel !== "admin" && !u.gerencia_usuarios) ? <Link href={`/admin/usuarios/${u.id}`} className="font-medium text-marinha hover:underline">Editar</Link> : <span className="text-xs text-slate-400">só o administrador geral</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
