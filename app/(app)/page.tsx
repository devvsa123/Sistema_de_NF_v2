import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { etapasAtivas, etapasDoUsuario, podeArmazenar, podeTratarReprovadas, prazoReprovada, vizinhos } from "@/lib/fluxo";
import { contagemFilas, fila } from "@/lib/notas";
import { dias, farol, moeda, data } from "@/lib/format";
import { FilaTabela, type BotaoFila, type LinhaFila } from "@/components/FilaTabela";
import { Indicador, Vazio, Cabecalho } from "@/components/ui";

export default async function MinhaFila({ searchParams }: PageProps<"/">) {
  const u = await exigirUsuario();
  if (u.papel !== "admin" && u.papel !== "interno") redirect("/notas");

  const [etapas, contagem, prazoReprov] = await Promise.all([etapasAtivas(), contagemFilas(), prazoReprovada()]);
  const abas = [
    ...etapasDoUsuario(u, etapas).map((e) => ({ chave: `e${e.id}`, nome: e.nome })),
    ...(podeTratarReprovadas(u) ? [{ chave: "reprovadas", nome: "Reprovadas" }] : []),
    ...(podeArmazenar(u, etapas) ? [{ chave: "armazenar", nome: "Para armazenar" }] : []),
  ];
  if (!abas.length)
    return <Vazio>Seu usuário ainda não está associado a nenhuma etapa do caminho. Procure o administrador do sistema.</Vazio>;

  const pedida = String((await searchParams).aba ?? "");
  const aba = abas.find((a) => a.chave === pedida) ?? abas[0];
  const etapa = aba.chave.startsWith("e") ? etapas.find((e) => `e${e.id}` === aba.chave)! : null;
  const notas = await fila(etapa ? { etapa: etapa.id } : (aba.chave as "reprovadas" | "armazenar"));
  const prazo = etapa ? etapa.prazo_dias : aba.chave === "reprovadas" ? prazoReprov : null;

  const botoes: BotaoFila[] = [];
  if (etapa) {
    const { anterior, proxima } = vizinhos(etapas, etapa.id);
    if (anterior) botoes.push({ acao: "retornar", rotulo: `← Devolver para ${anterior.nome}`, estilo: "sec" });
    if (etapa.permite_reprovar) botoes.push({ acao: "reprovar", rotulo: "Reprovar", estilo: "perigo" });
    if (etapa.exige_arrecadacao) botoes.push({ acao: "arrecadar", rotulo: "Marcar como arrecadada", estilo: "sec" });
    botoes.push({ acao: "avancar", rotulo: proxima ? `Enviar para ${proxima.nome} →` : "Finalizar ✓" });
  } else if (aba.chave === "reprovadas") {
    // a NF reprovada volta para a etapa em que foi reprovada (normalmente a Perícia)
    const origens = [...new Set(notas.map((n) => n.etapa_nome).filter(Boolean))];
    const destino = origens.length === 1 ? origens[0] : "a etapa em que foi reprovada";
    botoes.push({ acao: "reabrir", rotulo: `← Voltar para ${destino}`, estilo: "sec" }, { acao: "retirar", rotulo: "Retirada pelo fornecedor" });
  } else botoes.push({ acao: "armazenar", rotulo: "Marcar como armazenada" });

  const linhas: LinhaFila[] = notas.map((n) => ({
    id: n.id, numero: n.numero, empresa: n.emit_nome, valor: moeda(n.valor), oc: n.oc ?? "", recebida: data(n.recebida_em),
    dias: aba.chave === "armazenar" ? dias(n.dias_arrecadada) : dias(n.dias_etapa),
    farol: prazo !== null ? farol(Number(n.dias_etapa), prazo) : null,
    obs: n.ultima_obs ?? "", obsOc: n.obs_oc ?? "", arrecadada: !!n.arrecadada_em,
    situacao: aba.chave === "reprovadas" ? `Reprovada em ${n.etapa_nome ?? "—"}` : undefined,
  }));
  const atrasadas = prazo !== null ? notas.filter((n) => Number(n.dias_etapa) > prazo).length : 0;
  const media = notas.length ? notas.reduce((s, n) => s + Number(n.dias_etapa), 0) / notas.length : 0;
  const valorTotal = notas.reduce((s, n) => s + Number(n.valor), 0);

  return (
    <div className="space-y-4">
      <Cabecalho titulo="Minha fila" descricao="Notas fiscais aguardando ação nas etapas em que você atua. Selecione as NF e use os botões no fim da lista para tramitar." />
      <div className="flex flex-wrap gap-1.5">
        {abas.map((a) => (
          <Link
            key={a.chave}
            href={`/?aba=${a.chave}`}
            className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 ring-inset transition ${
              a.chave === aba.chave ? "bg-marinha text-white ring-marinha" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
            }`}
          >
            {a.nome}
            <span className={`ml-2 rounded-full px-1.5 text-xs ${a.chave === aba.chave ? "bg-white/20" : "bg-slate-100 text-slate-600"}`}>
              {contagem[a.chave] ?? 0}
            </span>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador titulo="Notas na fila" valor={notas.length} />
        <Indicador titulo="Valor total" valor={moeda(valorTotal)} />
        {prazo !== null && (
          <>
            <Indicador titulo={`Acima do prazo (${prazo} dias)`} valor={atrasadas} cor={atrasadas ? "text-red-600" : "text-emerald-600"} />
            <Indicador
              titulo="Tempo médio na etapa" valor={notas.length ? dias(media) : "—"}
              cor={media > prazo ? "text-red-600" : media > prazo * 0.7 ? "text-amber-600" : "text-emerald-600"}
            />
          </>
        )}
      </div>

      {notas.length === 0 ? (
        <Vazio>Nenhuma nota fiscal nesta fila. 🎉</Vazio>
      ) : (
        <FilaTabela key={aba.chave} linhas={linhas} botoes={botoes} mostrarArrecadacao={!!etapa?.exige_arrecadacao} />
      )}
    </div>
  );
}
