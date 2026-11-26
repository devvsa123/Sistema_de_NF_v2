import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirUsuario, podeCadastrar } from "@/lib/auth";
import { etapasAtivas } from "@/lib/fluxo";
import { Cabecalho } from "@/components/ui";
import { FormAcao } from "@/components/FormAcao";
import { ArquivoLimitado } from "@/components/ArquivoLimitado";
import { acaoCadastrarMapa } from "@/app/acoes/notas";

export const metadata = { title: "Cadastrar Mapa de devolução — Tramitação de NF" };

export default async function NovoMapa() {
  const u = await exigirUsuario();
  if (!podeCadastrar(u)) redirect("/");
  const etapas = await etapasAtivas();
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Cabecalho titulo="Cadastrar Mapa de devolução" descricao={<>Devolução de material recebida de um CAM. O mapa entra na etapa <strong>{etapas[0]?.nome ?? "—"}</strong> e segue o mesmo caminho das NF, no trâmite próprio de Mapas de devolução (sem a exigência de documentos). Para notas fiscais, use <Link href="/notas/nova" className="font-medium text-marinha hover:underline">Cadastrar NF</Link>.</>} />
      <FormAcao acao={acaoCadastrarMapa} botao="Cadastrar mapa de devolução" className="cartao grid gap-4 p-5 sm:grid-cols-2">
        <label><span className="rotulo">Nº do mapa de devolução *</span><input name="numero" className="campo" required maxLength={40} /></label>
        <label><span className="rotulo">Data do mapa</span><input type="date" name="data" defaultValue={hoje} className="campo" /></label>
        <label className="sm:col-span-2"><span className="rotulo">CAM (OM) que devolveu *</span><input name="cam" className="campo" required maxLength={200} placeholder="Ex.: CAM da OM ..." /></label>
        <label className="sm:col-span-2"><span className="rotulo">Observação</span><textarea name="obs" className="campo" rows={3} maxLength={2000} /></label>
        <label className="sm:col-span-2"><span className="rotulo">Mapa digitalizado (PDF, opcional)</span>
          <ArquivoLimitado name="arquivo" accept=".pdf,application/pdf" limiteMb={4} className="campo py-1.5" />
          <span className="mt-1 block text-xs text-slate-500">Se anexar, ele fica nos documentos do mapa. Até 4 MB.</span></label>
      </FormAcao>
    </div>
  );
}
