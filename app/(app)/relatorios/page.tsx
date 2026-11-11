import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { relatorioMensal } from "@/lib/relatorios";
import { data, dias, mesAtual, moeda, nomeMes } from "@/lib/format";
import { Indicador, Cabecalho } from "@/components/ui";
import { BotaoImprimir } from "@/components/BotaoImprimir";

export const metadata = { title: "Relatórios — Tramitação de NF" };

const pct = (parte: number, total: number) => (total ? `${((parte / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—");

function Barra({ valor, max, cor = "bg-marinha" }: { valor: number; max: number; cor?: string }) {
  return (
    <span className="inline-block h-2 w-full min-w-16 rounded-full bg-slate-100 align-middle">
      <span className={`block h-2 rounded-full ${cor}`} style={{ width: `${max ? Math.min(100, (valor / max) * 100) : 0}%` }} />
    </span>
  );
}

export default async function Relatorios({ searchParams }: PageProps<"/relatorios">) {
  const u = await exigirUsuario();
  if (u.papel === "empresa") redirect("/notas");
  const pedido = String((await searchParams).mes ?? "");
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(pedido) ? pedido : mesAtual();
  const { resumo: r, porEtapa, porEmpresa, serie, reprovadas } = await relatorioMensal(mes);
  const decididas = r.finalizadas + r.reprovadas;
  const maxSerie = Math.max(1, ...serie.map((s) => Math.max(s.recebidas, s.finalizadas)));
  const maxEtapa = Math.max(1, ...porEtapa.map((e) => Math.max(Number(e.media ?? 0), e.prazo_dias)));

  return (
    <div className="space-y-5">
      <Cabecalho titulo={`Relatório mensal — ${nomeMes(mes)}`} descricao="Indicadores do mês para prestação de contas. Datas no horário de Brasília; tempos em dias corridos.">
        <form className="flex items-end gap-2 print:hidden" action="/relatorios">
          <label><span className="rotulo">Mês</span><input type="month" name="mes" defaultValue={mes} className="campo" /></label>
          <button className="botao">Ver</button>
          <BotaoImprimir />
        </form>
      </Cabecalho>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador titulo="NF recebidas no mês" valor={r.recebidas} detalhe={moeda(r.valor_recebido)} />
        <Indicador titulo="NF finalizadas (aprovadas)" valor={r.finalizadas} detalhe={`${pct(r.finalizadas, decididas)} das decididas no mês`} cor="text-emerald-600" />
        <Indicador titulo="NF reprovadas" valor={r.reprovadas} detalhe={`${pct(r.reprovadas, decididas)} das decididas no mês`} cor={r.reprovadas ? "text-red-600" : "text-slate-700"} />
        <Indicador titulo="Tempo médio de tramitação" valor={r.tempo_medio === null ? "—" : dias(r.tempo_medio)}
          detalhe={r.tempo_medio === null ? "Nenhuma NF finalizada no mês" : `Mediana ${dias(r.tempo_mediano)} · máximo ${dias(r.tempo_maximo)}`} />
      </div>
      <p className="text-xs text-slate-500">
        “Decididas no mês” = finalizadas + reprovadas no período. Tempo de tramitação = do recebimento até a finalização, para as NF finalizadas no mês.
        Retiradas pelo fornecedor no mês: {r.retiradas}. NF em aberto hoje: {r.em_aberto}.
      </p>

      <div className="cartao overflow-x-auto">
        <h2 className="px-5 pt-5 text-[15px] font-semibold text-slate-900">Tempo médio por etapa</h2>
        <table className="tabela mt-3">
          <thead><tr><th>Etapa</th><th>Passagens concluídas</th><th>Tempo médio</th><th className="w-1/4"></th><th>Prazo</th><th>Maior tempo</th><th>Fora do prazo</th></tr></thead>
          <tbody>
            {porEtapa.map((e) => {
              const m = e.media === null ? null : Number(e.media);
              return (
                <tr key={e.id}>
                  <td className="font-medium">{e.nome}</td>
                  <td>{e.passagens}</td>
                  <td className={m !== null && m > e.prazo_dias ? "font-semibold text-red-600" : ""}>{m === null ? "—" : dias(m)}</td>
                  <td>{m !== null && <Barra valor={m} max={maxEtapa} cor={m > e.prazo_dias ? "bg-red-500" : "bg-marinha"} />}</td>
                  <td>{e.prazo_dias} dias</td>
                  <td>{e.maximo === null ? "—" : dias(e.maximo)}</td>
                  <td>{e.passagens ? `${e.fora_prazo} (${pct(e.fora_prazo, e.passagens)})` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="cartao overflow-x-auto">
        <h2 className="px-5 pt-5 text-[15px] font-semibold text-slate-900">Últimos 12 meses</h2>
        <table className="tabela mt-3">
          <thead><tr><th>Mês</th><th>Recebidas</th><th className="w-1/5"></th><th>Finalizadas</th><th>Reprovadas</th><th>% reprovação</th><th>Tempo médio</th></tr></thead>
          <tbody>
            {serie.map((s) => (
              <tr key={s.mes} className={s.mes === mes ? "!bg-blue-50" : ""}>
                <td className="whitespace-nowrap font-medium"><Link href={`/relatorios?mes=${s.mes}`} className="text-marinha hover:underline">{nomeMes(s.mes)}</Link></td>
                <td>{s.recebidas}</td>
                <td><Barra valor={s.recebidas} max={maxSerie} /></td>
                <td>{s.finalizadas}</td>
                <td className={s.reprovadas ? "text-red-600" : ""}>{s.reprovadas}</td>
                <td>{pct(s.reprovadas, s.finalizadas + s.reprovadas)}</td>
                <td>{s.tempo_medio === null ? "—" : dias(s.tempo_medio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="cartao overflow-x-auto">
          <h2 className="px-5 pt-5 text-[15px] font-semibold text-slate-900">Por empresa no mês</h2>
          <table className="tabela mt-3">
            <thead><tr><th>Empresa</th><th>Recebidas</th><th>Finalizadas</th><th>Reprovadas</th><th className="text-right">Valor recebido</th></tr></thead>
            <tbody>
              {porEmpresa.length === 0 && <tr><td colSpan={5} className="text-center text-slate-500">Sem movimento no mês.</td></tr>}
              {porEmpresa.map((e) => (
                <tr key={e.emit_cnpj}>
                  <td><Link href={`/notas?cnpj=${e.emit_cnpj}`} className="text-marinha hover:underline">{e.nome}</Link></td>
                  <td>{e.recebidas}</td><td>{e.finalizadas}</td>
                  <td className={e.reprovadas ? "text-red-600" : ""}>{e.reprovadas}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{moeda(e.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="cartao overflow-x-auto">
          <h2 className="px-5 pt-5 text-[15px] font-semibold text-slate-900">Reprovações do mês</h2>
          <table className="tabela mt-3">
            <thead><tr><th>NF</th><th>Empresa</th><th>Data</th><th>Motivo</th></tr></thead>
            <tbody>
              {reprovadas.length === 0 && <tr><td colSpan={4} className="text-center text-slate-500">Nenhuma reprovação no mês.</td></tr>}
              {reprovadas.map((x, i) => (
                <tr key={i}>
                  <td><Link href={`/notas/${x.id}`} className="font-semibold text-marinha hover:underline">{x.numero}</Link></td>
                  <td>{x.emit_nome}</td><td className="whitespace-nowrap">{data(x.criado_em)}</td><td className="text-xs text-slate-600">{x.texto}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
