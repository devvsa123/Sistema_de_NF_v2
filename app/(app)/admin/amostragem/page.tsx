import { exigirAdmin } from "@/lib/auth";
import { etapasAtivas } from "@/lib/fluxo";
import { levantamentoPesagem } from "@/lib/amostragem-nf";
import { Cabecalho } from "@/components/ui";
import { PlanoPesagem } from "@/components/PlanoPesagem";

export const metadata = { title: "Contagem por pesagem (amostragem) — Administração" };

/** Ferramenta temporária: levantamento e plano de contagem por pesagem por amostragem (somente o administrador geral). */
export default async function AmostragemPesagem({ searchParams }: PageProps<"/admin/amostragem">) {
  await exigirAdmin();
  const sp = await searchParams;
  const etapas = await etapasAtivas();
  const padrao = etapas.filter((e) => /contagem|pr[eé].?receb/i.test(`${e.nome} ${e.setor}`)).map((e) => e.id);
  const pedidas = [sp.e ?? []].flat().map(Number).filter((id) => etapas.some((e) => e.id === id));
  const ids = pedidas.length ? pedidas : padrao;
  const nfs = await levantamentoPesagem(ids);
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Cabecalho titulo="Contagem por pesagem (amostragem)" descricao="Ferramenta temporária, só do administrador geral: levantamento das NF que aguardam a contagem, por item e volumes, e o plano de contagem por pesagem por amostragem para aprovação do Diretor." />
      <form className="cartao flex flex-wrap items-end gap-3 p-4 text-sm">
        <span className="rotulo w-full">NF em trâmite nas etapas</span>
        {etapas.map((e) => (
          <label key={e.id} className="flex items-center gap-1.5"><input type="checkbox" name="e" value={e.id} defaultChecked={ids.includes(e.id)} /> {e.nome}</label>
        ))}
        <button className="botao-sec h-9">Atualizar levantamento</button>
      </form>
      <PlanoPesagem nfs={nfs.map((n) => ({ ...n, recebida: n.recebida.toISOString() }))} etapas={ids} />
    </div>
  );
}
