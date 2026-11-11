import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { etapasAtivas, prazoReprovada } from "@/lib/fluxo";
import { diasDoPeriodo, evolucaoTempos, hojeSP, periodo, porFornecedor, produtividade, somarDias, tendencia, visaoGeral } from "@/lib/gerencial";
import { cnpj, data, dias, moeda, nomeMes } from "@/lib/format";
import { Indicador, Vazio, Cabecalho } from "@/components/ui";
import { Abas } from "@/components/AbasBusca";
import { AbaAlertas, AbaFila, AbaFluxo, AbaPrevisao, AbaRetrabalho } from "./gestao";
import { BarrasEmpilhadas, COR, ColunasDiarias, Legenda, LinhaComFaixa } from "@/components/graficos";

export const metadata = { title: "Gerencial — Tramitação de NF" };

const ABAS = [
  ["visao", "Visão geral"],
  ["alertas", "Alertas"],
  ["fluxo", "Fluxo e gargalos"],
  ["fila", "Fila (FIFO)"],
  ["previsao", "Previsão"],
  ["tempos", "Tempos"],
  ["produtividade", "Produtividade"],
  ["retrabalho", "Retrabalho"],
  ["fornecedores", "Fornecedores"],
] as const;

const pct = (parte: number, total: number) => (total ? `${((parte / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—");
const mesCurto = (ym: string) => {
  const [a, m] = ym.split("-");
  return `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(m) - 1]}/${a.slice(2)}`;
};

function Cartao({ titulo, children, acao }: { titulo: string; children: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <section className="cartao p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-slate-900">{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

function FiltroPeriodo({ aba, de, ate, extra, atalhos }: { aba: string; de: string; ate: string; extra?: React.ReactNode; atalhos: [string, number][] }) {
  const hoje = hojeSP();
  return (
    <form action="/gerencial" className="cartao flex flex-wrap items-end gap-3 p-4 print:hidden">
      <input type="hidden" name="aba" value={aba} />
      <label><span className="rotulo">De</span><input type="date" name="de" defaultValue={de} className="campo" /></label>
      <label><span className="rotulo">Até</span><input type="date" name="ate" defaultValue={ate} max={hoje} className="campo" /></label>
      {extra}
      <button className="botao">Aplicar</button>
      <div className="flex flex-wrap gap-1.5 text-xs">
        {atalhos.map(([nome, n]) => (
          <Link key={nome} href={`/gerencial?aba=${aba}&de=${somarDias(hoje, -(n - 1))}&ate=${hoje}`}
            className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-200">{nome}</Link>
        ))}
      </div>
    </form>
  );
}

export default async function Gerencial({ searchParams }: PageProps<"/gerencial">) {
  const u = await exigirUsuario();
  if (u.papel === "empresa") redirect("/notas");
  const sp = await searchParams;
  const p = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]);
  const aba = ABAS.some(([k]) => k === p("aba")) ? (p("aba") as string) : "visao";

  return (
    <div className="space-y-5">
      <Cabecalho titulo="Gerencial" descricao="Situação e desempenho da tramitação. Tempos em dias corridos; datas no horário de Brasília. Passe o mouse sobre os gráficos para ver os valores." />
      <Abas atual={aba} itens={ABAS.map(([k, nome]) => [k, `/gerencial?aba=${k}`, nome] as const)} />
      {aba === "visao" && <AbaVisao de={p("de")} ate={p("ate")} />}
      {aba === "tempos" && <AbaTempos metrica={p("metrica")} meses={p("meses")} />}
      {aba === "produtividade" && <AbaProdutividade de={p("de")} ate={p("ate")} />}
      {aba === "fornecedores" && <AbaFornecedores de={p("de")} ate={p("ate")} />}
      {aba === "alertas" && <AbaAlertas />}
      {aba === "fluxo" && <AbaFluxo janela={p("janela")} />}
      {aba === "fila" && <AbaFila janela={p("janela")} />}
      {aba === "previsao" && <AbaPrevisao />}
      {aba === "retrabalho" && <AbaRetrabalho janela={p("janela")} />}
    </div>
  );
}

// ---------------- Visão geral ----------------

async function AbaVisao({ de: deP, ate: ateP }: { de?: string; ate?: string }) {
  const prazoReprov = await prazoReprovada();
  const { de, ate } = periodo(deP, ateP, 90);
  const { setores, paradas, kpi, paraArmazenar } = await visaoGeral(prazoReprov, de, ate);
  const decididas = kpi.finalizadas + kpi.reprovadas;
  const situacao = (s: (typeof setores)[number]) => s.chave === "reprovadas" ? "situacao=reprovada" : `situacao=etapa:${s.chave.slice(1)}`;

  return (
    <div className="space-y-5">
      <h2 className="text-base font-bold text-slate-700">Agora</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador titulo="NF em aberto" valor={kpi.abertas} detalhe={moeda(kpi.valor_aberto)} />
        <Indicador titulo="Fora do prazo do setor" valor={kpi.fora_prazo} detalhe={`${pct(kpi.fora_prazo, kpi.abertas)} das NF em aberto`}
          cor={kpi.fora_prazo ? "text-red-600" : "text-emerald-600"} />
        <Indicador titulo="Idade média das NF em aberto" valor={kpi.idade_media === null ? "—" : dias(kpi.idade_media)} detalhe="desde o recebimento" />
        <Indicador titulo="Arrecadadas aguardando armazenagem" valor={paraArmazenar} />
      </div>

      <Cartao titulo="NF em cada setor e situação do prazo">
        <BarrasEmpilhadas
          legenda={[{ cor: COR.bom, nome: "No prazo" }, { cor: COR.atencao, nome: "Próximo do limite (acima de 70% do prazo)" }, { cor: COR.critico, nome: "Prazo estourado" }]}
          linhas={setores.map((s) => ({
            rotulo: <Link href={`/notas?${situacao(s)}`} className="hover:underline">{s.nome}</Link>,
            total: s.total,
            partes: [{ valor: s.verde, cor: COR.bom, nome: "No prazo" }, { valor: s.amarelo, cor: COR.atencao, nome: "Próximo do limite" }, { valor: s.vermelho, cor: COR.critico, nome: "Prazo estourado" }],
            detalhe: s.vermelho ? <span className="text-red-600">· {s.vermelho} atrasada(s)</span> : null,
          }))}
        />
        <div className="mt-5 overflow-x-auto">
          <table className="tabela">
            <thead>
              <tr><th>Setor</th><th>Prazo</th><th>NF</th><th>🟢 No prazo</th><th>🟡 Próximo</th><th>🔴 Estourado</th><th>Tempo médio no setor</th><th>Mais antiga</th><th className="text-right">Valor</th></tr>
            </thead>
            <tbody>
              {setores.map((s) => (
                <tr key={s.chave}>
                  <td className="font-medium">{s.nome}</td>
                  <td>{s.prazo} dias</td>
                  <td className="font-semibold">{s.total}</td>
                  <td>{s.total ? `${s.verde} (${pct(s.verde, s.total)})` : "—"}</td>
                  <td>{s.total ? `${s.amarelo} (${pct(s.amarelo, s.total)})` : "—"}</td>
                  <td className={s.vermelho ? "font-semibold text-red-600" : ""}>{s.total ? `${s.vermelho} (${pct(s.vermelho, s.total)})` : "—"}</td>
                  <td className={s.media !== null && Number(s.media) > s.prazo ? "font-semibold text-red-600" : ""}>{s.media === null ? "—" : dias(s.media)}</td>
                  <td>{s.maximo === null ? "—" : dias(s.maximo)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{moeda(s.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Cartao>

      <Cartao titulo="NF há mais tempo em cada setor (10 mais antigas)">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {setores.filter((s) => s.total > 0).map((s) => (
            <div key={s.chave} className="rounded-lg border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
                <span className="text-sm font-semibold text-slate-700">{s.nome}</span>
                <Link href={`/notas?${situacao(s)}`} className="text-xs font-medium text-marinha hover:underline">ver todas ({s.total})</Link>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {paradas.filter((n) => n.chave === s.chave).map((n) => {
                    const d = Number(n.dias);
                    const cor = d > s.prazo ? COR.critico : d > s.prazo * 0.7 ? COR.atencao : COR.bom;
                    return (
                      <tr key={n.id} className="border-b border-slate-50 last:border-0">
                        <td className="px-3 py-1.5"><Link href={`/notas/${n.id}`} className="font-semibold text-marinha hover:underline">{n.numero}</Link></td>
                        <td className="max-w-40 truncate px-1 py-1.5 text-xs text-slate-600" title={n.emit_nome}>{n.emit_nome}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs">
                          <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: cor }} />{dias(d)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        {setores.every((s) => s.total === 0) && <p className="text-sm text-slate-500">Nenhuma NF em aberto.</p>}
      </Cartao>

      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <h2 className="text-base font-bold text-slate-700">No período de {data(de + "T12:00:00")} a {data(ate + "T12:00:00")}</h2>
      </div>
      <FiltroPeriodo aba="visao" de={de} ate={ate} atalhos={[["30 dias", 30], ["90 dias", 90], ["6 meses", 182], ["12 meses", 365]]} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador titulo="NF recebidas" valor={kpi.recebidas} detalhe={`${kpi.ocs} OC(s) distintas`} />
        <Indicador titulo="NF finalizadas" valor={kpi.finalizadas} detalhe={moeda(kpi.valor_finalizado)} cor="text-emerald-600" />
        <Indicador titulo="NF reprovadas" valor={kpi.reprovadas} detalhe={`${pct(kpi.reprovadas, decididas)} das decididas · ${kpi.retiradas} retirada(s)`} cor={kpi.reprovadas ? "text-red-600" : "text-slate-700"} />
        <Indicador titulo="Tempo médio de tramitação" valor={kpi.tempo_medio === null ? "—" : dias(kpi.tempo_medio)}
          detalhe={kpi.tempo_mediano === null ? "nenhuma NF finalizada no período" : `mediana ${dias(kpi.tempo_mediano)} · NF finalizadas`} />
      </div>
    </div>
  );
}

// ---------------- Tempos ----------------

async function AbaTempos({ metrica: mP, meses: mesesP }: { metrica?: string; meses?: string }) {
  const etapas = await etapasAtivas();
  const etapa = etapas.find((e) => String(e.id) === mP);
  const meses = [6, 12, 24, 0].includes(Number(mesesP)) ? Number(mesesP) : 12;
  const pontos = await evolucaoTempos(etapa ? etapa.id : "total", meses);
  const t = tendencia(pontos.filter((p) => p.n >= 5)); // meses com poucas NF distorcem a tendência
  const nome = etapa ? `Tempo em ${etapa.nome}` : "Tempo total de tramitação";
  const totalNF = pontos.reduce((s, p) => s + p.n, 0);
  const mediaGeral = totalNF ? pontos.reduce((s, p) => s + p.media * p.n, 0) / totalNF : null;

  let aviso = null;
  if (t) {
    const v = t.variacao * 100;
    const intensidade = Math.abs(v) > 30 ? "forte" : Math.abs(v) > 15 ? "moderada" : "leve";
    const piora = v > 0;
    const classe = intensidade === "forte" ? (piora ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800")
      : intensidade === "moderada" ? (piora ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800") : "bg-slate-50 text-slate-700";
    aviso = (
      <p className={`rounded-lg px-4 py-3 text-sm ${classe}`}>
        {piora ? "▲" : "▼"} <strong>{nome}</strong>: tendência {intensidade} de <strong>{piora ? "aumento" : "redução"}</strong> de{" "}
        {Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% (de {dias(t.inicial)} para {dias(t.final)}, média móvel de 3 meses),
        com consistência de {(t.consistencia * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% ao longo de {t.meses} meses (meses com menos de 5 NF não entram no cálculo).
        {piora ? " Tempo maior é pior." : " Tempo menor é melhor."}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <form action="/gerencial" className="cartao flex flex-wrap items-end gap-3 p-4 print:hidden">
        <input type="hidden" name="aba" value="tempos" />
        <label>
          <span className="rotulo">Métrica</span>
          <select name="metrica" defaultValue={etapa ? String(etapa.id) : ""} className="campo">
            <option value="">Tempo total (recebimento → finalização)</option>
            {etapas.map((e) => <option key={e.id} value={e.id}>Tempo em {e.nome}</option>)}
          </select>
        </label>
        <label>
          <span className="rotulo">Período</span>
          <select name="meses" defaultValue={String(meses)} className="campo">
            <option value="6">Últimos 6 meses</option><option value="12">Últimos 12 meses</option>
            <option value="24">Últimos 24 meses</option><option value="0">Todo o histórico</option>
          </select>
        </label>
        <button className="botao">Aplicar</button>
      </form>

      {pontos.length === 0 ? <Vazio>Sem dados para esta métrica no período.</Vazio> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Indicador titulo="NF consideradas" valor={totalNF} detalhe={etapa ? "que saíram da etapa no período" : "finalizadas no período"} />
            <Indicador titulo="Tempo médio" valor={mediaGeral === null ? "—" : dias(mediaGeral)} />
            <Indicador titulo="Mês mais rápido" valor={dias(Math.min(...pontos.map((p) => p.media)))} detalhe={nomeMes(pontos.reduce((a, b) => (b.media < a.media ? b : a)).mes)} cor="text-emerald-600" />
            <Indicador titulo="Mês mais lento" valor={dias(Math.max(...pontos.map((p) => p.media)))} detalhe={nomeMes(pontos.reduce((a, b) => (b.media > a.media ? b : a)).mes)} cor="text-red-600" />
          </div>
          {aviso}
          <Cartao titulo={`${nome} — média por mês`}>
            <div className="mb-3">
              <Legenda itens={[
                { cor: COR.serie, nome: "Média do mês", forma: "linha" },
                { cor: COR.faixa, nome: "Metade central das NF (entre 25% e 75%)" },
                ...(etapa ? [{ cor: COR.critico, nome: `Prazo do setor (${etapa.prazo_dias} dias)`, forma: "linha" as const }] : []),
              ]} />
            </div>
            <LinhaComFaixa
              pontos={pontos.map((p) => ({ rotulo: mesCurto(p.mes), valor: p.media, faixa: [p.p25, p.p75], detalhe: `${p.n} NF · mediana ${p.mediana.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}` }))}
              limite={etapa ? { valor: etapa.prazo_dias, nome: "prazo" } : undefined}
            />
            <p className="mt-2 text-xs text-slate-500">
              {etapa ? "Cada NF entra no mês em que saiu da etapa; quando passou mais de uma vez pela etapa, os tempos são somados." : "Cada NF entra no mês em que foi finalizada."}
            </p>
          </Cartao>
          <Cartao titulo="Estatísticas por mês">
            <div className="overflow-x-auto">
              <table className="tabela">
                <thead><tr><th>Mês</th><th>NF</th><th>Média</th><th>Mínimo</th><th>25%</th><th>Mediana</th><th>75%</th><th>Máximo</th></tr></thead>
                <tbody>
                  {[...pontos].reverse().map((p) => (
                    <tr key={p.mes}>
                      <td className="whitespace-nowrap font-medium">{nomeMes(p.mes)}</td><td>{p.n}</td>
                      <td className={etapa && p.media > etapa.prazo_dias ? "font-semibold text-red-600" : "font-semibold"}>{dias(p.media)}</td>
                      <td>{dias(p.minimo)}</td><td>{dias(p.p25)}</td><td>{dias(p.mediana)}</td><td>{dias(p.p75)}</td><td>{dias(p.maximo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Cartao>
        </>
      )}
    </div>
  );
}

// ---------------- Produtividade ----------------

async function AbaProdutividade({ de: deP, ate: ateP }: { de?: string; ate?: string }) {
  const { de, ate } = periodo(deP, ateP, 30, 366);
  const [etapas, { porDia, porUsuario }] = await Promise.all([etapasAtivas(), produtividade(de, ate)]);
  const calendario = diasDoPeriodo(de, ate);
  const uteis = calendario.filter((d) => !d.fimDeSemana).length || 1;

  const resumo = etapas.map((e) => {
    const linhas = porDia.filter((l) => l.etapa_id === e.id);
    const mapa = new Map(linhas.map((l) => [l.dia, l.avancos]));
    const serie = calendario.map((d) => ({ ...d, valor: mapa.get(d.data) ?? 0 }));
    const total = linhas.reduce((s, l) => s + l.avancos, 0);
    const retornos = linhas.reduce((s, l) => s + l.retornos, 0);
    const maximo = serie.reduce((b, d) => (d.valor > b.valor ? d : b), serie[0]);
    return { e, serie, total, retornos, media: total / uteis, maximo, diasCom: serie.filter((d) => d.valor > 0).length, usuarios: porUsuario.filter((x) => x.etapa_id === e.id) };
  });

  return (
    <div className="space-y-5">
      <FiltroPeriodo aba="produtividade" de={de} ate={ate} atalhos={[["7 dias", 7], ["15 dias", 15], ["30 dias", 30], ["60 dias", 60], ["90 dias", 90]]} />
      <p className="text-sm text-slate-600">
        Conta as NF que cada setor <strong>despachou</strong> (enviou para a etapa seguinte, finalizou ou reprovou) em cada dia.
        Devoluções para a etapa anterior aparecem à parte. {calendario.length} dias no período, {uteis} dias úteis (segunda a sexta; feriados não são descontados).
      </p>

      <Cartao titulo="Resumo por setor">
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead><tr><th>Setor</th><th>NF despachadas</th><th>Média por dia útil</th><th>Máximo em um dia</th><th>Dias com tramitação</th><th>Devolvidas à etapa anterior</th></tr></thead>
            <tbody>
              {resumo.map((r) => (
                <tr key={r.e.id}>
                  <td className="font-medium"><a href={`#setor-${r.e.id}`} className="text-marinha hover:underline">{r.e.nome}</a></td>
                  <td className="font-semibold">{r.total}</td>
                  <td>{r.media.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</td>
                  <td>{r.maximo?.valor ? `${r.maximo.valor} (${data(r.maximo.data + "T12:00:00")})` : "—"}</td>
                  <td>{r.diasCom}</td>
                  <td>{r.retornos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Cartao>

      {resumo.map((r) => (
        <section key={r.e.id} id={`setor-${r.e.id}`} className="cartao scroll-mt-4 p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold text-slate-900">{r.e.nome} — NF despachadas por dia</h2>
            <span className="text-xs text-slate-500">Fins de semana sombreados</span>
          </div>
          {r.total === 0 ? <p className="text-sm text-slate-500">Nenhuma NF despachada por este setor no período.</p> : (
            <div className="grid gap-5 lg:grid-cols-[1fr_16rem]">
              <div>
                <div className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <p><span className="block text-xs text-slate-500">Total</span><strong className="text-lg">{r.total}</strong></p>
                  <p><span className="block text-xs text-slate-500">Média por dia útil</span><strong className="text-lg">{r.media.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</strong></p>
                  <p><span className="block text-xs text-slate-500">Máximo em um dia</span><strong className="text-lg">{r.maximo.valor}</strong></p>
                  <p><span className="block text-xs text-slate-500">Dias com tramitação</span><strong className="text-lg">{r.diasCom}</strong></p>
                </div>
                <ColunasDiarias dias={r.serie} />
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Por usuário</p>
                <ul className="space-y-1 text-sm">
                  {r.usuarios.slice(0, 8).map((x) => (
                    <li key={x.usuario} className="flex justify-between gap-2"><span className="truncate" title={x.usuario}>{x.usuario}</span><strong className="tabular-nums">{x.n}</strong></li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

// ---------------- Fornecedores ----------------

async function AbaFornecedores({ de: deP, ate: ateP }: { de?: string; ate?: string }) {
  const { de, ate } = periodo(deP, ateP, 365);
  const linhas = await porFornecedor(de, ate);
  const tot = linhas.reduce((a, l) => ({ recebidas: a.recebidas + l.recebidas, valor: a.valor + Number(l.valor), finalizadas: a.finalizadas + l.finalizadas, reprovadas: a.reprovadas + l.reprovadas, abertas: a.abertas + l.abertas }),
    { recebidas: 0, valor: 0, finalizadas: 0, reprovadas: 0, abertas: 0 });
  return (
    <div className="space-y-5">
      <FiltroPeriodo aba="fornecedores" de={de} ate={ate} atalhos={[["90 dias", 90], ["6 meses", 182], ["12 meses", 365], ["24 meses", 730]]} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador titulo="Fornecedores com movimento" valor={linhas.length} />
        <Indicador titulo="NF recebidas" valor={tot.recebidas} detalhe={moeda(tot.valor)} />
        <Indicador titulo="Reprovação" valor={pct(tot.reprovadas, tot.finalizadas + tot.reprovadas)} detalhe={`${tot.reprovadas} reprovada(s) no período`} cor={tot.reprovadas ? "text-red-600" : "text-slate-700"} />
        <Indicador titulo="NF em aberto hoje" valor={tot.abertas} />
      </div>
      <Cartao titulo="Fornecedores">
        {linhas.length === 0 ? <p className="text-sm text-slate-500">Sem movimento no período.</p> : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>Empresa</th><th>NF recebidas</th><th className="text-right">Valor recebido</th><th>OC</th><th>Finalizadas</th><th>Reprovadas</th><th>% reprovação</th><th>Tempo médio</th><th>Em aberto hoje</th></tr></thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.emit_cnpj}>
                    <td><Link href={`/notas?cnpj=${l.emit_cnpj}`} className="font-medium text-marinha hover:underline">{l.nome}</Link><span className="block text-xs text-slate-400">{cnpj(l.emit_cnpj)}</span></td>
                    <td>{l.recebidas}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{moeda(l.valor)}</td>
                    <td>{l.ocs}</td>
                    <td>{l.finalizadas}</td>
                    <td className={l.reprovadas ? "font-semibold text-red-600" : ""}>{l.reprovadas}</td>
                    <td>{pct(l.reprovadas, l.finalizadas + l.reprovadas)}</td>
                    <td>{l.tempo_medio === null ? "—" : dias(l.tempo_medio)}</td>
                    <td>{l.abertas ? <Link href={`/notas?cnpj=${l.emit_cnpj}&situacao=em_tramite`} className="hover:underline">{l.abertas}</Link> : 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">% reprovação = reprovadas ÷ (finalizadas + reprovadas) no período. Tempo médio considera as NF finalizadas no período.</p>
      </Cartao>
    </div>
  );
}
