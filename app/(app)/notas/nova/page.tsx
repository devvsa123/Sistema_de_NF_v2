import { redirect } from "next/navigation";
import { exigirUsuario, podeCadastrar } from "@/lib/auth";
import { etapasAtivas } from "@/lib/fluxo";
import { EnvioXml } from "@/components/EnvioXml";
import { FormAcao } from "@/components/FormAcao";
import { acaoCadastrarManual } from "@/app/acoes/notas";

export const metadata = { title: "Cadastrar NF — Tramitação de NF" };

export default async function NovaNota() {
  const u = await exigirUsuario();
  if (!podeCadastrar(u)) redirect("/");
  const etapas = await etapasAtivas();
  const sobMedida = etapas.find((e) => e.entrada_sob_medida);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="titulo">Cadastrar notas fiscais</h1>
        <p className="mt-1 text-sm text-slate-600">
          As notas entram na etapa <strong>{etapas[0]?.nome ?? "—"}</strong>
          {sobMedida && <> (material sob medida entra direto em <strong>{sobMedida.nome}</strong>)</>}.
        </p>
      </div>
      <EnvioXml />
      <p className="text-sm text-slate-600">
        <strong>Sem acesso ao XML?</strong> No Portal da NF-e (nfe.fazenda.gov.br → Consultar NF-e), abra a nota pela chave de acesso, clique em imprimir e
        escolha <em>Salvar como PDF</em>. Envie esse PDF aqui: o sistema lê os mesmos dados (emitente, itens, totais, OC, empenho).
      </p>
      <details className="cartao p-5">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">Não tem XML nem PDF? Cadastrar manualmente</summary>
        <FormAcao acao={acaoCadastrarManual} botao="Cadastrar nota" className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2"><span className="rotulo">Chave de acesso (ou nº do documento)</span><input name="chave" className="campo" maxLength={60} /></label>
          <label><span className="rotulo">Número da NF</span><input name="numero" className="campo" required maxLength={20} /></label>
          <label><span className="rotulo">Valor total (R$)</span><input name="valor" className="campo" required inputMode="decimal" placeholder="1.234,56" /></label>
          <label><span className="rotulo">CNPJ da empresa</span><input name="cnpj" className="campo" required maxLength={20} /></label>
          <label><span className="rotulo">Nome da empresa</span><input name="nome" className="campo" required maxLength={200} /></label>
          <label><span className="rotulo">OC</span><input name="oc" className="campo" maxLength={60} /></label>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="sob_medida" /> Material sob medida</label>
          <label className="sm:col-span-2"><span className="rotulo">Observação</span><input name="obs" className="campo" maxLength={2000} /></label>
          <span className="sm:col-span-2" />
        </FormAcao>
      </details>
    </div>
  );
}
