import { Cabecalho } from "@/components/ui";
import { exigirAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { Importador } from "@/components/Importador";

export const metadata = { title: "Importar planilha — Administração" };
export const maxDuration = 60;

export default async function Importar() {
  await exigirAdmin();
  const [c] = await sql`select (select count(*)::int from notas) as notas, (select count(*)::int from usuarios) as usuarios`;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Cabecalho titulo="Importar dados do sistema antigo" descricao={<>Hoje o banco tem <strong>{c.notas}</strong> nota(s) e <strong>{c.usuarios}</strong> usuário(s).</>} />
      <ol className="cartao list-decimal space-y-1.5 p-5 pl-9 text-sm text-slate-700">
        <li>No Google Planilhas, abra a planilha <strong>Laboratório</strong> e use <em>Arquivo → Fazer download → Microsoft Excel (.xlsx)</em>.</li>
        <li>Selecione o arquivo abaixo e importe primeiro os <strong>usuários</strong>, depois as <strong>notas</strong>.</li>
        <li>
          Os usuários mantêm a senha que já usam e terão de trocá-la no primeiro acesso. Os perfis antigos são convertidos automaticamente
          (confira em Usuários).
        </li>
        <li>Pode repetir a importação sem medo: linhas já importadas são ignoradas. O arquivo é lido no seu navegador e não fica armazenado.</li>
      </ol>
      <Importador />
    </div>
  );
}
