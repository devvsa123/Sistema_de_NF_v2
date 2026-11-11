import { notFound } from "next/navigation";
import { exigirAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { etapasAtivas } from "@/lib/fluxo";
import { FormAcao } from "@/components/FormAcao";
import { Voltar } from "@/components/ui";
import { acaoSalvarUsuario } from "@/app/acoes/admin";

export const metadata = { title: "Usuário — Administração" };

export default async function EditarUsuario({ params }: PageProps<"/admin/usuarios/[id]">) {
  await exigirAdmin();
  const { id } = await params;
  const novo = id === "novo";
  const [u] = novo ? [null] : await sql`select u.*, coalesce((select array_agg(etapa_id) from usuario_etapas where usuario_id = u.id), '{}') as etapas from usuarios u where u.id = ${Number(id) || 0}`;
  if (!novo && !u) notFound();
  const etapas = await etapasAtivas();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Voltar href="/admin/usuarios">Usuários</Voltar>
      <h1 className="titulo">{novo ? "Novo usuário" : `Editar ${u!.nome}`}</h1>
      <FormAcao acao={acaoSalvarUsuario} botao="Salvar usuário" className="cartao space-y-5 p-5">
        {!novo && <input type="hidden" name="id" value={u!.id} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <label><span className="rotulo">Nome</span><input name="nome" defaultValue={u?.nome ?? ""} className="campo" required maxLength={120} /></label>
          <label><span className="rotulo">Login (NIP ou CNPJ)</span><input name="login" defaultValue={u?.login ?? ""} className="campo" required inputMode="numeric" /></label>
        </div>

        <fieldset className="space-y-2">
          <legend className="rotulo">Perfil de acesso</legend>
          {[
            ["interno", "Interno", "Tramita NF nas etapas marcadas abaixo e consulta todas as NF."],
            ["consulta", "Consulta", "Vê todas as NF e relatórios, sem tramitar (ex.: COMRJ)."],
            ["empresa", "Fornecedor", "Vê somente as NF emitidas pelo próprio CNPJ, sem observações internas."],
            ["admin", "Administrador", "Acesso total: caminho, usuários, ajustes e todas as etapas."],
          ].map(([valor, nome, desc]) => (
            <label key={valor} className="flex items-start gap-2 text-sm">
              <input type="radio" name="papel" value={valor} defaultChecked={(u?.papel ?? "interno") === valor} className="mt-1" required />
              <span><strong>{nome}</strong> — <span className="text-slate-600">{desc}</span></span>
            </label>
          ))}
        </fieldset>

        <fieldset className="space-y-2 rounded-lg bg-slate-50 p-3">
          <legend className="rotulo">Somente para perfil Interno</legend>
          <p className="text-xs text-slate-500">Etapas em que o usuário pode tramitar:</p>
          <div className="grid gap-1.5 text-sm sm:grid-cols-2">
            {etapas.map((e) => (
              <label key={e.id} className="flex items-center gap-2">
                <input type="checkbox" name="etapas" value={e.id} defaultChecked={u?.etapas?.includes(e.id)} /> {e.nome}
              </label>
            ))}
          </div>
          <div className="grid gap-1.5 border-t border-slate-200 pt-2 text-sm sm:grid-cols-2">
            <label className="flex items-center gap-2"><input type="checkbox" name="pode_cadastrar" defaultChecked={u?.pode_cadastrar} /> Cadastra NF (envio de XML)</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="trata_reprovadas" defaultChecked={u?.trata_reprovadas} /> Trata NF reprovadas</label>
          </div>
        </fieldset>

        <label className="block">
          <span className="rotulo">Somente para Fornecedor: CNPJ da empresa</span>
          <input name="empresa_cnpj" defaultValue={u?.empresa_cnpj ?? ""} className="campo" placeholder="Se vazio, usa o login" inputMode="numeric" />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="rotulo">{novo ? "Senha inicial" : "Nova senha (vazio = manter)"}</span>
            <input name="senha" type="password" className="campo" autoComplete="new-password" minLength={8} required={novo} />
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="deve_trocar" defaultChecked /> Exigir troca de senha no próximo acesso</label>
        </div>

        {!novo && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="ativo" defaultChecked={u!.ativo} /> Usuário ativo</label>}
      </FormAcao>
    </div>
  );
}
