import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { FormAcao } from "@/components/FormAcao";
import { acaoTrocarSenha } from "@/app/acoes/auth";

export const metadata = { title: "Trocar senha — Tramitação de NF" };

export default async function TrocarSenha() {
  const u = await exigirUsuario({ permitirTrocaPendente: true });
  return (
    <>
      <h2 className="text-lg font-bold text-slate-800">Trocar senha</h2>
      <p className="mb-4 mt-1 text-sm text-slate-500">
        {u.deve_trocar_senha ? "Por segurança, defina uma nova senha antes de continuar." : `Usuário: ${u.nome}`}
      </p>
      <FormAcao acao={acaoTrocarSenha} botao="Salvar nova senha" className="space-y-4" classeBotao="botao w-full">
        <div>
          <label className="rotulo" htmlFor="atual">Senha atual</label>
          <input id="atual" name="atual" type="password" className="campo" autoComplete="current-password" required />
        </div>
        <div>
          <label className="rotulo" htmlFor="nova">Nova senha (mínimo 8 caracteres)</label>
          <input id="nova" name="nova" type="password" className="campo" autoComplete="new-password" required minLength={8} />
        </div>
        <div>
          <label className="rotulo" htmlFor="confirmar">Confirmar nova senha</label>
          <input id="confirmar" name="confirmar" type="password" className="campo" autoComplete="new-password" required minLength={8} />
        </div>
      </FormAcao>
      {!u.deve_trocar_senha && (
        <p className="mt-4 text-center text-sm"><Link href="/" className="text-marinha hover:underline">Cancelar</Link></p>
      )}
    </>
  );
}
