import Image from "next/image";
import Link from "next/link";
import { exigirUsuario, podeCadastrar } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { acaoSair } from "@/app/acoes/auth";

const PAPEL: Record<string, string> = { admin: "Administrador", interno: "Usuário interno", consulta: "Consulta", empresa: "Fornecedor" };

export default async function LayoutApp({ children }: LayoutProps<"/">) {
  const u = await exigirUsuario();
  const itens = [
    ...(u.papel === "admin" || u.papel === "interno" ? [{ href: "/", rotulo: "Minha fila" }] : []),
    { href: "/notas", rotulo: u.papel === "empresa" ? "Minhas notas" : "Notas fiscais" },
    ...(podeCadastrar(u) ? [{ href: "/notas/nova", rotulo: "Cadastrar NF" }] : []),
    ...(u.papel !== "empresa" ? [{ href: "/relatorios", rotulo: "Relatórios" }] : []),
    ...(u.papel === "admin"
      ? [
          { href: "/admin/caminho", rotulo: "Caminho" },
          { href: "/admin/usuarios", rotulo: "Usuários" },
          { href: "/admin/importar", rotulo: "Importar" },
        ]
      : []),
  ];
  return (
    <div className="min-h-screen">
      <header className="bg-marinha text-white print:hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/brasao.png" alt="" width={148} height={192} className="h-9 w-auto" />
            <span className="leading-tight">
              <span className="block text-sm font-bold">Tramitação de NF</span>
              <span className="block text-[11px] text-white/70">DepFMRJ</span>
            </span>
          </Link>
          <Nav itens={itens} />
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-right leading-tight">
              <span className="block font-semibold">{u.nome}</span>
              <span className="block text-[11px] text-white/70">{PAPEL[u.papel]}</span>
            </span>
            <Link href="/trocar-senha" className="rounded-lg px-2 py-1 text-white/85 hover:bg-white/15">Senha</Link>
            <form action={acaoSair}>
              <button className="cursor-pointer rounded-lg border border-white/30 px-3 py-1 hover:bg-white/15">Sair</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
