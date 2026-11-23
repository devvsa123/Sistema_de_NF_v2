import { exigirAdmin } from "@/lib/auth";
import { etapasAtivas } from "@/lib/fluxo";
import { regrasDocumentos, usoArmazenamento } from "@/lib/documentos";
import { armazenamentoExterno } from "@/lib/arquivos";
import { Cabecalho } from "@/components/ui";
import { FormAcao } from "@/components/FormAcao";
import { acaoSalvarExigenciaPacote, acaoSalvarRegrasDocumentos, acaoSalvarTipoDocumento, acaoTestarArmazenamento } from "@/app/acoes/documentos";
import { exigePacoteFinal } from "@/lib/pacote";

export const metadata = { title: "Documentos da NF — Administração" };

const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;

export default async function AdminDocumentos() {
  await exigirAdmin();
  const [{ tipos, regras }, etapas, uso, exigePacote] = await Promise.all([regrasDocumentos(), etapasAtivas(), usoArmazenamento(), exigePacoteFinal()]);
  const r2 = armazenamentoExterno();
  const marcado = (e: number, t: number) => regras.some((r) => r.etapa_id === e && r.tipo_id === t);
  const ativos = tipos.filter((t) => t.ativo);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Cabecalho titulo="Documentos da NF" descricao="Tipos de documento, quais são obrigatórios para a NF sair de cada etapa e onde os arquivos ficam guardados." />

      <section className="cartao space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-slate-900">Pacote final obrigatório para finalizar a NF</h2>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${exigePacote ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"}`}>{exigePacote ? "Ligado" : "Desligado"}</span>
        </div>
        <p className="text-sm text-slate-600">
          <strong>Ligado:</strong> na última etapa ({etapas[etapas.length - 1]?.nome ?? "—"}), a NF só finaliza com todos os documentos anexados e assinados e com o pacote final
          (documentos + histórico em ZIP) baixado e conferido; na finalização os arquivos são excluídos do sistema.<br />
          <strong>Desligado:</strong> a NF finaliza como antes, mesmo sem documentos (trâmite antigo). O pacote continua disponível, opcional, na página da NF;
          os arquivos só são excluídos se o pacote tiver sido baixado e conferido.
        </p>
        <FormAcao acao={acaoSalvarExigenciaPacote} botao="Salvar" classeBotao="botao h-9" className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="exigir" defaultChecked={exigePacote} /> Exigir o pacote final para finalizar a NF</label>
        </FormAcao>
      </section>

      <section className="cartao space-y-3 p-5">
        <h2 className="text-[15px] font-semibold text-slate-900">Documentos obrigatórios por etapa</h2>
        <p className="text-sm text-slate-600">Marque o que a NF precisa ter anexado para ser enviada à etapa seguinte. Documentos “assinados” só contam com assinatura digital íntegra (gov.br ou token). As NF que já estão na etapa também passam a precisar do documento para avançar.</p>
        <FormAcao acao={acaoSalvarRegrasDocumentos} botao="Salvar documentos obrigatórios" className="space-y-3">
          <div className="overflow-x-auto">
            <table className="tabela text-sm">
              <thead><tr><th>Etapa</th>{ativos.map((t) => <th key={t.id} className="text-center normal-case tracking-normal">{t.nome}{t.exige_assinatura ? " ✍" : ""}</th>)}</tr></thead>
              <tbody>
                {etapas.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap font-medium">{e.nome}</td>
                    {ativos.map((t) => (
                      <td key={t.id} className="text-center"><input type="checkbox" name="regra" value={`${e.id}:${t.id}`} defaultChecked={marcado(e.id, t.id)} aria-label={`${t.nome} obrigatório para sair de ${e.nome}`} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">✍ = exige assinatura digital.</p>
        </FormAcao>
      </section>

      <section className="cartao space-y-3 p-5">
        <h2 className="text-[15px] font-semibold text-slate-900">Tipos de documento</h2>
        <div className="space-y-2">
          {tipos.map((t) => (
            <FormAcao key={t.id} acao={acaoSalvarTipoDocumento} botao="Salvar" classeBotao="botao-sec h-9" className="flex flex-wrap items-end gap-3 border-b border-slate-100 pb-2">
              <input type="hidden" name="id" value={t.id} />
              <label className="min-w-56 flex-1"><span className="rotulo">Nome</span><input name="nome" defaultValue={t.nome} className="campo" maxLength={80} required /></label>
              <label className="w-20"><span className="rotulo">Ordem</span><input name="ordem" type="number" defaultValue={t.ordem} className="campo" min={0} max={999} /></label>
              <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" name="exige_assinatura" defaultChecked={t.exige_assinatura} /> Exige assinatura</label>
              <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" name="ativo" defaultChecked={t.ativo} /> Ativo</label>
            </FormAcao>
          ))}
          <FormAcao acao={acaoSalvarTipoDocumento} botao="Adicionar tipo" classeBotao="botao h-9" className="flex flex-wrap items-end gap-3 pt-2">
            <label className="min-w-56 flex-1"><span className="rotulo">Novo tipo de documento</span><input name="nome" className="campo" maxLength={80} required placeholder="Ex.: Ofício de envio ao laboratório" /></label>
            <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" name="exige_assinatura" /> Exige assinatura</label>
          </FormAcao>
        </div>
      </section>

      <section className="cartao space-y-3 p-5">
        <h2 className="text-[15px] font-semibold text-slate-900">Armazenamento dos arquivos</h2>
        <p className="text-sm text-slate-600">
          {r2 ? "Os arquivos são guardados no Cloudflare R2." : "O Cloudflare R2 ainda não foi configurado: os arquivos estão sendo guardados no banco de dados, que tem pouco espaço no plano gratuito. Configure o R2 (variáveis R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY e R2_BUCKET na Vercel) antes de usar em volume."}
        </p>
        <p className="text-sm text-slate-700">{uso.arquivos} arquivo(s) · {mb(uso.bytes)} no total{uso.noBanco ? ` · ${mb(uso.noBanco)} no banco de dados` : ""}</p>
        <FormAcao acao={acaoTestarArmazenamento} botao="Testar armazenamento" classeBotao="botao-sec" className="space-y-2" />
      </section>
    </div>
  );
}
