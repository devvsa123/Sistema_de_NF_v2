import { exigirAdmin } from "@/lib/auth";
import { analisarModelo, camposFixos, modeloAtual } from "@/lib/laudo";
import { DOCUMENTOS, ehDoc, type ChaveDoc } from "@/lib/modelos-docs";
import { Abas } from "@/components/AbasBusca";
import { dataHora } from "@/lib/format";
import { Cabecalho } from "@/components/ui";
import { FormAcao } from "@/components/FormAcao";
import { acaoEnviarModelo, acaoRestaurarModelo, acaoSalvarCamposFixos } from "@/app/acoes/laudo";

export const metadata = { title: "Modelos de documentos — Administração" };

const Marcador = ({ chave }: { chave: string }) => (
  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12px] text-slate-800">{`{{${chave}}}`}</code>
);

export default async function ModeloLaudo({ searchParams }: PageProps<"/admin/laudo">) {
  await exigirAdmin();
  const pedido = (await searchParams).doc;
  const doc: ChaveDoc = ehDoc(pedido) ? pedido : "laudo_pericial";
  const info = DOCUMENTOS[doc];
  const [fixos, modelo] = await Promise.all([camposFixos(), modeloAtual(doc)]);
  const { achados, desconhecidos } = analisarModelo(modelo.arquivo, fixos, info.marcadores);
  const usados = new Set(achados);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Cabecalho titulo="Modelos de documentos" descricao="Altere os nomes e textos fixos (como o do Diretor) e os arquivos usados como modelo do laudo pericial, do TAV e do Check-list de Recebimento." />

      <section className="cartao p-5">
        <h2 className="text-[15px] font-semibold text-slate-900">Campos fixos</h2>
        <p className="mb-4 mt-1 text-sm text-slate-500">
          Valores que se repetem em todos os documentos. Mude o valor e salve: os próximos laudos já saem atualizados. Laudos emitidos antes mantêm os nomes da época.
        </p>
        <FormAcao acao={acaoSalvarCamposFixos} botao="Salvar campos fixos" className="space-y-3">
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>Descrição</th><th>Marcador no Word</th><th className="w-1/2">Valor</th><th>Remover</th></tr></thead>
              <tbody>
                {fixos.map((c) => (
                  <tr key={c.chave}>
                    <td><input type="hidden" name="chave" value={c.chave} /><input name="rotulo" defaultValue={c.rotulo} className="campo" maxLength={80} /></td>
                    <td className="whitespace-nowrap align-middle"><Marcador chave={c.chave} />{!usados.has(c.chave) && <span className="ml-2 text-xs text-amber-700">não usado no modelo</span>}</td>
                    <td><input name="valor" defaultValue={c.valor} className="campo" maxLength={500} /></td>
                    <td className="align-middle"><input type="checkbox" name="remover" value={c.chave} aria-label={`Remover ${c.rotulo}`} /></td>
                  </tr>
                ))}
                <tr className="bg-slate-50/60">
                  <td><input name="nova_rotulo" className="campo" placeholder="Novo campo (ex.: Encarregado da DT)" maxLength={80} /></td>
                  <td><input name="nova_chave" className="campo font-mono" placeholder="encarregado_nome" maxLength={40} /></td>
                  <td><input name="nova_valor" className="campo" placeholder="Valor" maxLength={500} /></td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">Para usar um campo novo, inclua o marcador correspondente no arquivo do Word (ex.: {"{{encarregado_nome}}"}) e envie o modelo abaixo.</p>
        </FormAcao>
      </section>

      <section className="cartao p-5">
        <Abas atual={doc} itens={(Object.keys(DOCUMENTOS) as ChaveDoc[]).map((k) => [k, `/admin/laudo?doc=${k}`, DOCUMENTOS[k].nome] as const)} />
        <h2 className="mt-5 text-[15px] font-semibold text-slate-900">Arquivo do modelo — {info.nome}</h2>
        <p className="mt-1 text-xs text-slate-500">Emitido por: {info.quem}.</p>
        <p className="mt-1 text-sm text-slate-500">
          Atual: <strong>{modelo.nome}</strong> · atualizado em {dataHora(modelo.atualizadoEm)}{modelo.por ? ` por ${modelo.por}` : ""} · {achados.length} marcadores.
        </p>
        {desconhecidos.length > 0 && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Marcadores não reconhecidos (sairão em branco): {desconhecidos.join(", ")}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={`/api/laudo/modelo?doc=${doc}`} className="botao-sec">Baixar modelo atual</a>
          <a href={`/api/laudo/modelo?doc=${doc}&exemplo=1`} className="botao-sec">Baixar exemplo preenchido</a>
        </div>
        <ol className="mt-5 list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>Baixe o modelo atual e abra no Word ou no LibreOffice.</li>
          <li>Altere o texto e o layout à vontade. Onde quiser um dado, escreva o marcador entre chaves duplas, por exemplo {"{{numero_nf}}"}.</li>
          <li>Salve como <strong>.docx</strong> ou <strong>.odt</strong> e envie abaixo. Depois baixe o exemplo preenchido para conferir.</li>
        </ol>
        <FormAcao acao={acaoEnviarModelo} botao="Enviar novo modelo" className="mt-4 flex flex-wrap items-end gap-3" confirmar={`Substituir o modelo de "${info.nome}" por este arquivo?`}>
          <input type="hidden" name="doc" value={doc} />
          <label className="min-w-64 flex-1"><span className="rotulo">Arquivo .docx ou .odt</span><input type="file" name="arquivo" accept=".docx,.odt" className="campo pt-1.5" required /></label>
        </FormAcao>
        <FormAcao acao={acaoRestaurarModelo} botao="Restaurar modelo padrão" classeBotao="botao-perigo" className="mt-4 flex items-center gap-3" confirmar={`Voltar ao modelo padrão de "${info.nome}"? O modelo atual será substituído.`}>
          <input type="hidden" name="doc" value={doc} />
        </FormAcao>
      </section>

      <section className="cartao p-5">
        <h2 className="mb-3 text-[15px] font-semibold text-slate-900">Marcadores disponíveis — {info.nome}</h2>
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead><tr><th>Marcador</th><th>O que entra</th><th>Origem</th><th>No modelo atual</th></tr></thead>
            <tbody>
              {[...info.marcadores, ...fixos.map((f) => ({ chave: f.chave, descricao: f.rotulo, origem: "Campo fixo" }))].map((m) => (
                <tr key={m.chave}>
                  <td className="whitespace-nowrap"><Marcador chave={m.chave} /></td>
                  <td>{m.descricao}</td>
                  <td className="text-xs text-slate-500">{m.origem === "NF" ? "Automático (NF)" : m.origem === "Perito" ? "Formulário do perito" : m.origem === "Recebimento" ? "Formulário do Recebimento" : "Campo fixo"}</td>
                  <td className="text-xs">{usados.has(m.chave) ? "✓ usado" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
