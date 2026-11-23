import { Cabecalho } from "@/components/ui";
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
      <Cabecalho titulo="Cadastrar notas fiscais" descricao={<>
          As notas entram na etapa <strong>{etapas[0]?.nome ?? "—"}</strong>
          {sobMedida && <> (material sob medida entra direto em <strong>{sobMedida.nome}</strong>)</>}.
        </>} />
      <EnvioXml />
      <p className="text-sm text-slate-600">
        <strong>PDF da DANFE:</strong> baixe a DANFE pela chave de acesso e envie o PDF aqui. O sistema lê emitente, itens, totais, OC e empenho,
        confere tudo com a chave de acesso e já anexa o PDF na NF com o certificado (material ou serviço) como última página, para as assinaturas.
        Também são aceitos o XML da NF-e e o PDF da consulta completa no Portal da NF-e.
      </p>
      <details className="cartao p-5">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">Não conseguiu o PDF pela chave de acesso? Cadastrar manualmente com a NF digitalizada</summary>
        <FormAcao acao={acaoCadastrarManual} botao="Cadastrar nota" className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2"><span className="rotulo">NF digitalizada (PDF) *</span>
            <input type="file" name="digitalizada" accept=".pdf,application/pdf" required className="campo py-1.5" />
            <span className="mt-1 block text-xs text-slate-500">Obrigatória para a NF seguir no trâmite. O sistema acrescenta o certificado como última página e a anexa na NF para as assinaturas. Até 4 MB.</span></label>
          <fieldset className="sm:col-span-2"><legend className="rotulo">Tipo da NF *</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="radio" name="tipo_nf" value="material" defaultChecked required /> Material — Certificado de Recebimento de Bens</label>
              <label className="flex items-center gap-2"><input type="radio" name="tipo_nf" value="servico" /> Serviço — Certificado de Prestação de Serviços</label>
            </div>
          </fieldset>
          <label className="sm:col-span-2"><span className="rotulo">Chave de acesso (ou nº do documento)</span><input name="chave" className="campo" maxLength={60} /></label>
          <label><span className="rotulo">Número da NF</span><input name="numero" className="campo" required maxLength={20} /></label>
          <label><span className="rotulo">Valor total (R$)</span><input name="valor" className="campo" required inputMode="decimal" placeholder="1.234,56" /></label>
          <label><span className="rotulo">CNPJ da empresa</span><input name="cnpj" className="campo" required maxLength={20} /></label>
          <label><span className="rotulo">Nome da empresa</span><input name="nome" className="campo" required maxLength={200} /></label>
          <label><span className="rotulo">OC (ordem de compra) *</span><input name="oc" className="campo" maxLength={60} required inputMode="numeric" placeholder="7 dígitos, ex.: 1173226" /></label>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="sob_medida" /> Material sob medida</label>
          <label className="sm:col-span-2"><span className="rotulo">Observação</span><input name="obs" className="campo" maxLength={2000} /></label>
          <span className="sm:col-span-2" />
        </FormAcao>
      </details>
    </div>
  );
}
