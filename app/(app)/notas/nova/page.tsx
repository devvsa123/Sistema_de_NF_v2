import { Cabecalho } from "@/components/ui";
import { redirect } from "next/navigation";
import { exigirUsuario, podeCadastrar } from "@/lib/auth";
import { etapasAtivas } from "@/lib/fluxo";
import { EnvioXml } from "@/components/EnvioXml";
import { FormChave } from "@/components/FormChave";

export const metadata = { title: "Cadastrar NF — Tramitação de NF" };

export default async function NovaNota() {
  const u = await exigirUsuario();
  if (!podeCadastrar(u)) redirect("/");
  const etapas = await etapasAtivas();
  const sobMedida = etapas.find((e) => e.entrada_sob_medida);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Cabecalho titulo="Cadastrar notas fiscais" descricao={<>
          As notas entram na etapa <strong>{etapas[0]?.nome ?? "—"}</strong>
          {sobMedida && <> (material sob medida entra direto em <strong>{sobMedida.nome}</strong>)</>}.
        </>} />
      <EnvioXml />
      <p className="text-sm text-slate-600">
        <strong>Sem acesso ao XML?</strong> No Portal da NF-e (nfe.fazenda.gov.br → Consultar NF-e), abra a nota pela chave de acesso, clique em imprimir e
        escolha <em>Salvar como PDF</em>. Envie esse PDF aqui: o sistema lê os mesmos dados (emitente, itens, totais, OC, empenho).
      </p>
      <section className="cartao p-5">
        <h2 className="text-[15px] font-semibold text-slate-900">Sem XML nem PDF: cadastrar pela chave de acesso</h2>
        <p className="mb-4 mt-1 text-sm text-slate-500">Digite ou cole a chave de acesso: o sistema confere a chave e preenche número, CNPJ e empresa. Falta só informar o valor.</p>
        <FormChave />
      </section>
    </div>
  );
}
