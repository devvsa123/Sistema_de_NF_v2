import { redirect } from "next/navigation";
import { existeAlgumUsuario } from "@/lib/auth";
import { FormAcao } from "@/components/FormAcao";
import { acaoSetup } from "@/app/acoes/auth";

export const metadata = { title: "Configuração inicial — Tramitação de NF" };
export const dynamic = "force-dynamic";

export default async function Setup() {
  if (await existeAlgumUsuario()) redirect("/login");
  return (
    <>
      <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Configuração inicial</h2>
      <p className="mb-4 mt-1 text-sm text-slate-500">Crie o primeiro usuário administrador. Esta tela deixa de existir depois disso.</p>
      <FormAcao acao={acaoSetup} botao="Criar administrador" className="space-y-4" classeBotao="botao w-full">
        <div>
          <label className="rotulo" htmlFor="nome">Nome</label>
          <input id="nome" name="nome" className="campo" required />
        </div>
        <div>
          <label className="rotulo" htmlFor="login">Usuário (NIP, somente números)</label>
          <input id="login" name="login" className="campo" inputMode="numeric" required />
        </div>
        <div>
          <label className="rotulo" htmlFor="senha">Senha (mínimo 8 caracteres)</label>
          <input id="senha" name="senha" type="password" className="campo" autoComplete="new-password" required minLength={8} />
        </div>
        <div>
          <label className="rotulo" htmlFor="confirmar">Confirmar senha</label>
          <input id="confirmar" name="confirmar" type="password" className="campo" autoComplete="new-password" required minLength={8} />
        </div>
      </FormAcao>
    </>
  );
}
