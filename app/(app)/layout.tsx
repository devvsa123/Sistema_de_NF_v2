import Link from "next/link";
import { exigirUsuario, podeCadastrar, podeGerirUsuarios } from "@/lib/auth";
import { Lateral, type GrupoMenu } from "@/components/Nav";
import { Icone } from "@/components/Icone";
import { acaoSair } from "@/app/acoes/auth";

const PAPEL: Record<string, string> = { admin: "Administrador geral", interno: "Usuário interno", consulta: "Consulta", empresa: "Fornecedor" };

export default async function LayoutApp({ children }: LayoutProps<"/">) {
  const u = await exigirUsuario();
  const operador = u.papel === "admin" || u.papel === "interno";
  const grupos: GrupoMenu[] = [
    {
      titulo: "Operação",
      itens: [
        ...(operador ? [{ href: "/", rotulo: "Minha fila", icone: "fila" }] : []),
        { href: "/notas", rotulo: u.papel === "empresa" ? "Minhas notas" : "Notas fiscais", icone: "notas" },
        ...(podeCadastrar(u) ? [{ href: "/notas/nova", rotulo: "Cadastrar NF", icone: "novo" }] : []),
      ],
    },
    ...(u.papel !== "empresa"
      ? [{ titulo: "Análises", itens: [{ href: "/gerencial", rotulo: "Gerencial", icone: "grafico" }, { href: "/relatorios", rotulo: "Relatório mensal", icone: "relatorio" }] }]
      : []),
    ...(u.papel === "admin"
      ? [{
          titulo: "Administração",
          itens: [
            { href: "/admin/caminho", rotulo: "Caminho da tramitação", icone: "caminho" },
            { href: "/admin/usuarios", rotulo: "Usuários", icone: "usuarios" },
            { href: "/admin/laudo", rotulo: "Modelo do laudo", icone: "relatorio" },
            { href: "/admin/importar", rotulo: "Importar planilha", icone: "importar" },
          ],
        }]
      : podeGerirUsuarios(u)
        ? [{ titulo: "Administração", itens: [{ href: "/admin/usuarios", rotulo: "Usuários e empresas", icone: "usuarios" }] }]
        : []),
    { titulo: "Ajuda", itens: [{ href: "/manual", rotulo: "Manual do usuário", icone: "manual" }] },
  ];
  const botao = "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white";
  return (
    <div className="min-h-screen">
      <Lateral
        grupos={grupos}
        usuario={{ nome: u.nome, papel: u.gerencia_usuarios && u.papel !== "admin" ? "Administrador de usuários" : PAPEL[u.papel] }}
        rodape={
          <div className="mt-1 space-y-0.5">
            <Link href="/trocar-senha" className={botao}><Icone nome="senha" className="h-4 w-4 text-slate-500" /> Trocar senha</Link>
            <form action={acaoSair}>
              <button className={`${botao} cursor-pointer`}><Icone nome="sair" className="h-4 w-4 text-slate-500" /> Sair</button>
            </form>
          </div>
        }
      />
      <div className="lg:pl-64 print:pl-0">
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
