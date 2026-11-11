import { exigirAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { etapasAtivas, prazoReprovada } from "@/lib/fluxo";
import { FormAcao } from "@/components/FormAcao";
import { acaoMoverEtapa, acaoPrazoReprovada, acaoRemoverEtapa, acaoSalvarEtapa } from "@/app/acoes/admin";

export const metadata = { title: "Caminho da tramitação — Administração" };

export default async function Caminho() {
  await exigirAdmin();
  const [etapas, prazoReprov, contagem] = await Promise.all([
    etapasAtivas(),
    prazoReprovada(),
    sql`select etapa_id, count(*)::int as n from notas where status in ('em_tramite','reprovada') group by etapa_id`,
  ]);
  const naEtapa = new Map(contagem.map((c) => [c.etapa_id, c.n]));

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="titulo">Caminho da tramitação</h1>
        <p className="mt-1 text-sm text-slate-600">
          As NF percorrem as etapas na ordem abaixo. Os usuários só conseguem enviar a NF para a <strong>etapa seguinte</strong> ou devolvê-la para a{" "}
          <strong>etapa anterior</strong>. Depois da última etapa a NF é finalizada. Alterações valem imediatamente; as NF em andamento permanecem na etapa em que estão.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="rounded-full bg-slate-200 px-3 py-1 font-medium text-slate-600">Cadastro</span>
        {etapas.map((e) => (
          <span key={e.id} className="flex items-center gap-1.5">
            <span className="text-slate-400">→</span>
            <span className="rounded-full bg-marinha px-3 py-1 font-medium text-white">{e.nome}</span>
          </span>
        ))}
        <span className="text-slate-400">→</span>
        <span className="rounded-full bg-emerald-500 px-3 py-1 font-medium text-white">Finalizada</span>
      </div>

      {etapas.map((e, i) => (
        <div key={e.id} className="cartao flex gap-4 p-4">
          <div className="flex flex-col items-center gap-1">
            <form action={acaoMoverEtapa.bind(null, e.id, -1)}>
              <button className="botao-sec !px-2 !py-1" disabled={i === 0} title="Mover para antes" aria-label={`Mover ${e.nome} para antes`}>▲</button>
            </form>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-marinha text-sm font-bold text-white">{i + 1}</span>
            <form action={acaoMoverEtapa.bind(null, e.id, 1)}>
              <button className="botao-sec !px-2 !py-1" disabled={i === etapas.length - 1} title="Mover para depois" aria-label={`Mover ${e.nome} para depois`}>▼</button>
            </form>
          </div>
          <div className="flex-1 space-y-3">
            <FormAcao acao={acaoSalvarEtapa} botao="Salvar" className="space-y-3" classeBotao="botao-sec">
              <input type="hidden" name="id" value={e.id} />
              <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
                <label><span className="rotulo">Nome da etapa</span><input name="nome" defaultValue={e.nome} className="campo" required maxLength={60} /></label>
                <label><span className="rotulo">Prazo (dias)</span><input name="prazo_dias" type="number" min={1} max={365} defaultValue={e.prazo_dias} className="campo" required /></label>
              </div>
              <div className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                <label className="flex items-center gap-2"><input type="checkbox" name="permite_reprovar" defaultChecked={e.permite_reprovar} /> Pode reprovar a NF nesta etapa</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="exige_arrecadacao" defaultChecked={e.exige_arrecadacao} /> Exige marcar “arrecadada” antes de avançar</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="faz_armazenagem" defaultChecked={e.faz_armazenagem} /> Usuários desta etapa marcam “armazenada”</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="entrada_sob_medida" defaultChecked={e.entrada_sob_medida} /> Entrada das NF de material sob medida</label>
              </div>
            </FormAcao>
            <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm text-slate-500">
              <span>{naEtapa.get(e.id) ?? 0} NF nesta etapa agora</span>
              <FormAcao acao={acaoRemoverEtapa} botao="Remover etapa" classeBotao="text-sm font-medium text-red-600 hover:underline cursor-pointer disabled:opacity-50"
                className="flex items-center gap-3" confirmar={`Remover a etapa "${e.nome}" do caminho?`}>
                <input type="hidden" name="id" value={e.id} />
              </FormAcao>
            </div>
          </div>
        </div>
      ))}

      <div className="cartao p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Adicionar etapa</h2>
        <FormAcao acao={acaoSalvarEtapa} botao="Adicionar ao final" className="grid items-end gap-3 sm:grid-cols-[1fr_9rem_auto]">
          <label><span className="rotulo">Nome</span><input name="nome" className="campo" required maxLength={60} /></label>
          <label><span className="rotulo">Prazo (dias)</span><input name="prazo_dias" type="number" min={1} max={365} defaultValue={5} className="campo" required /></label>
        </FormAcao>
        <p className="mt-2 text-xs text-slate-500">Depois de adicionar, use as setas para posicioná-la e associe os usuários em Usuários.</p>
      </div>

      <div className="cartao p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">NF reprovadas</h2>
        <FormAcao acao={acaoPrazoReprovada} botao="Salvar" className="flex flex-wrap items-end gap-3" classeBotao="botao-sec">
          <label><span className="rotulo">Prazo para retirada pelo fornecedor (dias)</span><input name="prazo" type="number" min={1} max={365} defaultValue={prazoReprov} className="campo w-40" /></label>
        </FormAcao>
      </div>
    </div>
  );
}
