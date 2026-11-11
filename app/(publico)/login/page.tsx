import { redirect } from "next/navigation";
import { existeAlgumUsuario, usuarioAtual } from "@/lib/auth";
import { FormAcao } from "@/components/FormAcao";
import { acaoEntrar } from "@/app/acoes/auth";

export const metadata = { title: "Entrar — Tramitação de NF" };

export default async function Login() {
  if (await usuarioAtual()) redirect("/");
  if (!(await existeAlgumUsuario())) redirect("/setup");
  return (
    <>
      <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Entrar</h2>
      <p className="mb-6 mt-1 text-sm text-slate-500">Use seu NIP ou o CNPJ da empresa e a sua senha.</p>
      <FormAcao acao={acaoEntrar} botao="Entrar" className="space-y-4" classeBotao="botao w-full">
        <div>
          <label className="rotulo" htmlFor="login">Usuário (NIP ou CNPJ)</label>
          <input id="login" name="login" className="campo" inputMode="numeric" autoComplete="username" required autoFocus />
        </div>
        <div>
          <label className="rotulo" htmlFor="senha">Senha</label>
          <input id="senha" name="senha" type="password" className="campo" autoComplete="current-password" required />
        </div>
      </FormAcao>
      <p className="mt-6 text-center text-xs text-slate-500">Esqueceu a senha? Procure o administrador do sistema.</p>
    </>
  );
}
