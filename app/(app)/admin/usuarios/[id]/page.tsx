import { notFound, redirect } from "next/navigation";
import { exigirGestorUsuarios } from "@/lib/auth";
import { sql } from "@/lib/db";
import { etapasAtivas, setoresDe, setorReprovadas } from "@/lib/fluxo";
import { FormAcao } from "@/components/FormAcao";
import { Voltar } from "@/components/ui";
import { acaoExcluirUsuario, acaoSalvarUsuario } from "@/app/acoes/admin";

export const metadata = { title: "Usuário — Administração" };

export default async function EditarUsuario({ params }: PageProps<"/admin/usuarios/[id]">) {
  const quem = await exigirGestorUsuarios();
  const geral = quem.papel === "admin";
  const { id } = await params;
  const novo = id === "novo";
  const [u] = novo ? [null] : await sql`select u.*, coalesce((select array_agg(etapa_id) from usuario_etapas where usuario_id = u.id), '{}') as etapas from usuarios u where u.id = ${Number(id) || 0}`;
  if (!novo && !u) notFound();
  if (!geral && u && (u.papel === "admin" || u.gerencia_usuarios)) redirect("/admin/usuarios");
  const [etapas, setorReprov] = await Promise.all([etapasAtivas(), setorReprovadas()]);
  const setores = setoresDe(etapas);
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
            ...(geral ? [["admin", "Administrador geral", "Acesso total: configurações, caminho, modelo do laudo, importação, usuários e ajustes."]] : []),
          ].map(([valor, nome, desc]) => (
            <label key={valor} className="flex items-start gap-2 text-sm">
              <input type="radio" name="papel" value={valor} defaultChecked={(u?.papel ?? "interno") === valor} className="mt-1" required />
              <span><strong>{nome}</strong> — <span className="text-slate-600">{desc}</span></span>
            </label>
          ))}
        </fieldset>

        {geral && (
          <label className="flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50/60 p-3 text-sm">
            <input type="checkbox" name="gerencia_usuarios" defaultChecked={u?.gerencia_usuarios} className="mt-1" />
            <span><strong>Administrador de usuários</strong> — <span className="text-slate-600">pode cadastrar e editar usuários e empresas (exceto administradores). Vale para os perfis Interno e Consulta.</span></span>
          </label>
        )}

        <fieldset className="space-y-2 rounded-lg bg-slate-50 p-3">
          <legend className="rotulo">Somente para perfil Interno</legend>
          <p className="text-xs text-slate-500">Setores em que o usuário trabalha (ele tramita em todas as etapas do setor):</p>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            {setores.map((s) => {
              const funcoes = [...s.etapas.map((e) => e.nome), ...(s.nome === setorReprov ? ["Reprovadas"] : [])];
              const mostra = funcoes.length > 1 || funcoes[0] !== s.nome;
              return (
                <label key={s.nome} className="flex items-start gap-2">
                  <input type="checkbox" name="setores" value={s.nome} className="mt-1" defaultChecked={s.etapas.some((e) => u?.etapas?.includes(e.id))} />
                  <span><span className="font-medium text-slate-800">{s.nome}</span>{mostra && <span className="block text-xs text-slate-500">{funcoes.join(", ")}</span>}</span>
                </label>
              );
            })}
          </div>
          <div className="grid gap-1.5 border-t border-slate-200 pt-2 text-sm sm:grid-cols-2">
            <label className="flex items-center gap-2"><input type="checkbox" name="pode_cadastrar" defaultChecked={u?.pode_cadastrar} /> Cadastra NF (envio de XML)</label>
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

      {geral && !novo && u!.id !== quem.id && (
        <section className="rounded-xl border border-red-200 bg-red-50/40 p-5">
          <h2 className="text-[15px] font-semibold text-red-800">Excluir usuário</h2>
          <p className="mb-3 mt-1 text-sm text-red-900/80">
            Remove o acesso de {u!.nome} definitivamente. As NF, laudos e o histórico de tramitação continuam no sistema com o nome dele.
            Se for só um afastamento, prefira desmarcar <strong>Usuário ativo</strong>.
          </p>
          <FormAcao acao={acaoExcluirUsuario} botao="Excluir usuário" classeBotao="botao-perigo" confirmar={`Excluir definitivamente o usuário ${u!.nome}? Esta ação não pode ser desfeita.`}>
            <input type="hidden" name="id" value={u!.id} />
          </FormAcao>
        </section>
      )}
    </div>
  );
}
