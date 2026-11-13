import Link from "next/link";
import { Cabecalho } from "@/components/ui";
import { exigirGestorUsuarios } from "@/lib/auth";
import { sql } from "@/lib/db";
import { etapasAtivas, setoresDe } from "@/lib/fluxo";
import { login } from "@/lib/format";
import { UsuariosTabela, type LinhaUsuario } from "@/components/UsuariosTabela";

export const metadata = { title: "Usuários — Administração" };

const PAPEL: Record<string, string> = { admin: "Administrador geral", interno: "Interno", consulta: "Consulta (vê tudo)", empresa: "Fornecedor" };

export default async function Usuarios({ searchParams }: PageProps<"/admin/usuarios">) {
  const quem = await exigirGestorUsuarios();
  const geral = quem.papel === "admin";
  const excluido = (await searchParams).excluido;
  const [usuarios, etapas] = await Promise.all([
    sql`
      select u.id, u.login, u.nome, u.papel, u.ativo, u.pode_cadastrar, u.gerencia_usuarios, u.deve_trocar_senha,
             coalesce((select array_agg(setor order by ordem) from (select e.setor, min(e.ordem) as ordem from usuario_etapas ue
                        join etapas e on e.id = ue.etapa_id and e.ativo where ue.usuario_id = u.id group by e.setor) s), '{}') as setores
      from usuarios u order by u.ativo desc, u.papel = 'empresa', u.nome`,
    etapasAtivas(),
  ]);
  const linhas: LinhaUsuario[] = usuarios.map((u) => ({
    id: u.id, nome: u.nome, login: u.login, loginFmt: login(u.login), papel: u.papel, papelNome: PAPEL[u.papel], setores: u.setores,
    gestor: u.gerencia_usuarios && u.papel !== "admin",
    permissoes: u.papel === "interno" ? [u.setores.join(", "), u.pode_cadastrar && "Cadastra NF"].filter(Boolean).join(" · ")
      : u.papel === "empresa" ? "Somente as NF do próprio CNPJ" : u.papel === "admin" ? "Acesso total" : "Consulta todas as NF e relatórios",
    ativo: u.ativo, situacao: u.ativo ? (u.deve_trocar_senha ? "Ativo · troca de senha pendente" : "Ativo") : "Inativo",
    editavel: geral || (u.papel !== "admin" && !u.gerencia_usuarios),
  }));
  return (
    <div className="space-y-4">
      <Cabecalho titulo="Usuários e empresas" descricao="Quem acessa o sistema, com qual perfil e em quais setores trabalha. Fornecedores (empresas) têm o CNPJ como login.">
        <Link href="/admin/usuarios/novo" className="botao">+ Novo usuário</Link>
      </Cabecalho>
      {typeof excluido === "string" && (
        <p className="rounded-lg bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800" role="status">Usuário <strong>{excluido}</strong> excluído.</p>
      )}
      <UsuariosTabela linhas={linhas} perfis={Object.entries(PAPEL)} setores={setoresDe(etapas).map((s) => s.nome)} />
    </div>
  );
}
