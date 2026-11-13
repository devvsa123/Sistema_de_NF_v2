import { exigirAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { configWms, situacaoEstoque } from "@/lib/estoque";
import { dataHora } from "@/lib/format";
import { Cabecalho } from "@/components/ui";
import { FormAcao } from "@/components/FormAcao";
import { acaoEnviarEstoque, acaoEnviarUz, acaoSalvarConfigWms, acaoSincronizarGithub } from "@/app/acoes/estoque";

export const metadata = { title: "Estoque (WMS) — Administração" };
export const maxDuration = 60;

export default async function EstoqueWms() {
  await exigirAdmin();
  const [c, est, [uz], [contagem]] = await Promise.all([
    configWms(),
    situacaoEstoque(),
    sql`select valor from config where chave = 'uz_sincronizado'`,
    sql`select (select count(*)::int from mapa_itens) as aprendidas, (select count(*)::int from estoque_itens) as itens`,
  ]);
  const uzInfo = uz ? (JSON.parse(uz.valor) as { em: string; registros: number }) : null;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Cabecalho titulo="Estoque (WMS)" descricao="Integração com as planilhas extraídas pelo RPA e publicadas no GitHub: catálogo do estoque com o padrão de caixa (CXP) e alocação das UZ por ID de PA." />

      <section className="cartao space-y-3 p-5">
        <h2 className="text-[15px] font-semibold text-slate-900">Catálogo do estoque ({c.planilhaEstoque})</h2>
        {est ? (
          <p className="text-sm text-slate-700">
            <strong>{contagem.itens.toLocaleString("pt-BR")}</strong> itens (PI) carregados de {est.linhas.toLocaleString("pt-BR")} linhas · atualizado em {dataHora(est.em)} · origem: {est.origem}
            {est.semCxp > 0 && <span className="text-amber-700"> · {est.semCxp} itens sem CXP no WMS</span>}
          </p>
        ) : <p className="text-sm text-amber-800">O catálogo ainda não foi carregado.</p>}
        <p className="text-sm text-slate-600">{contagem.aprendidas} correlação(ões) confirmadas pelos usuários (código ou descrição do fornecedor → PI).</p>
        <div className="flex flex-wrap items-start gap-6 border-t border-slate-100 pt-3">
          <FormAcao acao={acaoSincronizarGithub} botao="Atualizar agora do GitHub" className="space-y-2" classeBotao="botao" />
          <FormAcao acao={acaoEnviarEstoque} botao="Importar arquivo" className="flex flex-wrap items-end gap-2" classeBotao="botao-sec">
            <label><span className="rotulo">Ou envie o controle-estoque.xlsx</span><input type="file" name="arquivo" accept=".xlsx" className="campo pt-1.5" required /></label>
          </FormAcao>
        </div>
        <p className="text-xs text-slate-500">O sistema também busca a planilha no GitHub automaticamente uma vez por dia (6h).</p>
      </section>

      <section className="cartao space-y-3 p-5">
        <h2 className="text-[15px] font-semibold text-slate-900">Alocação das UZ (paletes)</h2>
        <p className="text-sm text-slate-600">
          {c.planilhaUz
            ? uzInfo ? `Planilha ${c.planilhaUz}: ${uzInfo.registros} registros · atualizada em ${dataHora(uzInfo.em)}.` : `Planilha ${c.planilhaUz} configurada, ainda não importada.`
            : "Aguardando a planilha de alocação das UZ. Quando o RPA passar a publicá-la, informe o nome do arquivo abaixo."}
        </p>
        <p className="text-sm text-slate-600">
          Armazenagem: {c.exigirUz ? <strong className="text-emerald-700">só é liberada com todas as UZ do ID de PA fora da LOC {c.locVirtual}.</strong> : <span>sem conferência das UZ (exigência desligada).</span>}
        </p>
        <FormAcao acao={acaoEnviarUz} botao="Importar arquivo de UZ" className="flex flex-wrap items-end gap-2" classeBotao="botao-sec">
          <label><span className="rotulo">Envio manual (.xlsx ou .csv com colunas ID de PA, UZ e LOC)</span><input type="file" name="arquivo" accept=".xlsx,.csv" className="campo pt-1.5" required /></label>
        </FormAcao>
      </section>

      <section className="cartao p-5">
        <h2 className="mb-1 text-[15px] font-semibold text-slate-900">Configuração</h2>
        <p className="mb-4 text-sm text-slate-600">
          Acesso ao GitHub: {c.tokenConfigurado ? <strong className="text-emerald-700">token configurado</strong>
            : <strong className="text-amber-700">token não configurado — o repositório é privado; crie a variável PLANILHAS_GITHUB_TOKEN na Vercel.</strong>}
        </p>
        <FormAcao acao={acaoSalvarConfigWms} botao="Salvar configuração" className="grid gap-4 sm:grid-cols-2" classeBotao="botao-sec">
          <label><span className="rotulo">Repositório (dono/nome)</span><input name="planilhas_repo" defaultValue={c.repo} className="campo font-mono" /></label>
          <label><span className="rotulo">Branch</span><input name="planilhas_branch" defaultValue={c.branch} className="campo font-mono" /></label>
          <label><span className="rotulo">Planilha do estoque</span><input name="planilha_estoque" defaultValue={c.planilhaEstoque} className="campo font-mono" /></label>
          <label><span className="rotulo">Planilha de alocação das UZ</span><input name="planilha_uz" defaultValue={c.planilhaUz} className="campo font-mono" placeholder="ainda não existe" /></label>
          <label><span className="rotulo">LOC virtual do recebimento</span><input name="loc_virtual" defaultValue={c.locVirtual} className="campo font-mono" /></label>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="exigir_uz_alocadas" defaultChecked={c.exigirUz} /> Só armazenar com todas as UZ alocadas</label>
          <span className="sm:col-span-2" />
        </FormAcao>
      </section>
    </div>
  );
}
