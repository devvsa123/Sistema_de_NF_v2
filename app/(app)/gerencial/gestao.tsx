import Link from "next/link";
import type { ReactNode } from "react";
import { etapasAtivas, prazoReprovada, type Etapa } from "@/lib/fluxo";
import { hojeSP, somarDias } from "@/lib/gerencial";
import {
  aderenciaFifo, alertas, balanco, envelhecimento, estoqueDiario, FAIXAS_IDADE, fluxoSemanal, previsoes, retrabalho, ultrapassadas,
} from "@/lib/gestao";
import { data, dias, moeda } from "@/lib/format";
import { Indicador, Vazio } from "@/components/ui";
import { AreasEmpilhadas, CATEGORICAS, COR, COR_OUTROS, Legenda, Linhas } from "@/components/graficos";

const pct = (parte: number, total: number, casas = 0) => (total ? `${((parte / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: casas })}%` : "—");
const corEtapa = (etapas: Etapa[], id: number) => (id === 0 ? COR_OUTROS : CATEGORICAS[etapas.findIndex((e) => e.id === id) % CATEGORICAS.length]);
const um = (n: number, casas = 1) => n.toLocaleString("pt-BR", { maximumFractionDigits: casas });

function Cartao({ titulo, descricao, children, acao }: { titulo: string; descricao?: ReactNode; children: ReactNode; acao?: ReactNode }) {
  return (
    <section className="cartao p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-900">{titulo}</h2>
          {descricao && <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-slate-500">{descricao}</p>}
        </div>
        {acao}
      </div>
      {children}
    </section>
  );
}

function Janela({ aba, atual, opcoes }: { aba: string; atual: number; opcoes: number[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs print:hidden">
      <span className="text-slate-500">Janela de análise:</span>
      {opcoes.map((d) => (
        <Link key={d} href={`/gerencial?aba=${aba}&janela=${d}`}
          className={`rounded-full px-2.5 py-1 font-medium ${d === atual ? "bg-marinha text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
          {d} dias
        </Link>
      ))}
    </div>
  );
}

const janelaValida = (v: string | undefined, opcoes: number[], padrao: number) => (opcoes.includes(Number(v)) ? Number(v) : padrao);

// ================================================================ Alertas

const NIVEL = {
  critico: { rotulo: "Crítico", icone: "▲", classe: "border-red-200 bg-red-50/60", selo: "bg-red-600 text-white" },
  atencao: { rotulo: "Atenção", icone: "●", classe: "border-amber-200 bg-amber-50/50", selo: "bg-amber-400 text-slate-900" },
  info: { rotulo: "Acompanhar", icone: "■", classe: "border-slate-200 bg-white", selo: "bg-slate-200 text-slate-700" },
};

export async function AbaAlertas() {
  const [etapas, prazoReprov] = await Promise.all([etapasAtivas(), prazoReprovada()]);
  const lista = await alertas(prazoReprov, etapas);
  const ativos = lista.filter((a) => a.notas.length || a.chave === "acumulo");
  const ok = lista.filter((a) => !a.notas.length && a.chave !== "acumulo");
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Pontos que pedem ação agora, do mais urgente para o menos urgente. Clique em cada alerta para ver as NF.
      </p>
      {ativos.length === 0 && <Vazio>Nenhum alerta no momento. A fila está andando dentro do esperado.</Vazio>}
      {ativos.map((a) => {
        const n = NIVEL[a.nivel];
        return (
          <details key={a.chave} className={`group rounded-xl border ${n.classe}`} open={a.nivel === "critico"}>
            <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-4">
              <span className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${n.selo}`}>{n.icone} {n.rotulo}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-900">{a.titulo}</span>
                <span className="block text-sm text-slate-600">{a.descricao}</span>
              </span>
              {a.notas.length > 0 && <span className="shrink-0 text-2xl font-semibold tabular-nums text-slate-900">{a.notas.length}</span>}
              {a.notas.length > 0 && <span className="mt-1.5 shrink-0 text-slate-400 transition group-open:rotate-90">›</span>}
            </summary>
            {a.notas.length > 0 && (
              <ul className="grid gap-x-6 border-t border-slate-200/70 px-5 py-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
                {a.notas.slice(0, 60).map((x) => (
                  <li key={x.id} className="flex items-baseline gap-2 py-1">
                    <Link href={`/notas/${x.id}`} className="shrink-0 font-semibold text-marinha hover:underline">{x.numero}</Link>
                    <span className="min-w-0 truncate text-slate-600" title={`${x.emit_nome} — ${x.detalhe}`}>{x.detalhe} · {x.emit_nome}</span>
                  </li>
                ))}
                {a.notas.length > 60 && <li className="py-1 text-slate-500">e mais {a.notas.length - 60}…</li>}
              </ul>
            )}
          </details>
        );
      })}
      {ok.length > 0 && (
        <div className="cartao px-5 py-4 text-sm text-slate-600">
          <p className="mb-1 font-semibold text-emerald-700">✓ Sem ocorrências</p>
          <ul className="list-disc space-y-0.5 pl-5">{ok.map((a) => <li key={a.chave}>{a.titulo}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

// ================================================================ Fluxo e gargalos

export async function AbaFluxo({ janela: jP }: { janela?: string }) {
  const janela = janelaValida(jP, [14, 30, 60, 90], 30);
  const ate = hojeSP(), de = somarDias(ate, -(janela - 1));
  const [etapas, bal, estoque, semanas] = await Promise.all([etapasAtivas(), balanco(janela), estoqueDiario(de, ate), fluxoSemanal(26)]);

  const linhas = etapas.map((e) => {
    const b = bal.find((x) => x.etapa_id === e.id)!;
    const vazao = b.saidas / janela; // NF por dia corrido
    const espera = vazao > 0 ? b.wip / vazao : b.wip > 0 ? Infinity : 0; // lei de Little
    return { e, b, vazao, espera, saldo: b.entradas - b.saidas, carga: espera / e.prazo_dias };
  });
  const gargalo = [...linhas].filter((l) => l.b.wip > 0).sort((a, b) => b.carga - a.carga)[0];

  const diasLista = Array.from({ length: janela }, (_, i) => somarDias(de, i));
  const chaves = [...etapas.map((e) => e.id), 0];
  const series = chaves.map((k) => ({
    nome: k === 0 ? "Reprovadas" : etapas.find((e) => e.id === k)!.nome,
    cor: corEtapa(etapas, k),
    valores: diasLista.map((d) => estoque.find((x) => x.dia === d && x.chave === k)?.n ?? 0),
  })).reverse(); // primeira etapa no topo, como num diagrama de fluxo acumulado

  const chegadas = semanas.reduce((s, x) => s + x.chegadas, 0), saidas = semanas.reduce((s, x) => s + x.saidas, 0);
  const ultimas4 = semanas.slice(-4);
  const saldo4 = ultimas4.reduce((s, x) => s + x.chegadas - x.saidas, 0);

  return (
    <div className="space-y-5">
      <Janela aba="fluxo" atual={janela} opcoes={[14, 30, 60, 90]} />

      {gargalo && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-amber-800">Gargalo atual</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{gargalo.e.nome}</p>
          <p className="text-sm text-slate-700">
            {gargalo.b.wip} NF na fila e saída média de {um(gargalo.vazao)} NF/dia: uma NF que entra hoje deve esperar cerca de{" "}
            <strong>{Number.isFinite(gargalo.espera) ? dias(gargalo.espera) : "indefinidamente (sem saídas na janela)"}</strong>, para um prazo de {gargalo.e.prazo_dias} dias.
          </p>
        </div>
      )}

      <Cartao titulo="Balanço da fila por setor"
        descricao={`Nos últimos ${janela} dias. Espera prevista = NF na fila ÷ saída média por dia (lei de Little): quanto tempo uma NF que chega hoje deve ficar no setor, mantido o ritmo atual. Saldo positivo = o setor recebe mais do que entrega e a fila cresce.`}>
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead><tr><th>Setor</th><th>Fila no início</th><th>Entraram</th><th>Saíram</th><th>Saldo</th><th>Fila hoje</th><th>Saída média</th><th>Espera prevista</th><th>Prazo</th><th>Situação</th></tr></thead>
            <tbody>
              {linhas.map(({ e, b, vazao, espera, saldo }) => {
                const estado = b.wip === 0 ? ["Sem fila", "text-slate-500"]
                  : espera > e.prazo_dias ? ["Fila acima da capacidade", "text-red-600"]
                  : saldo > 0 ? ["Fila crescendo", "text-amber-700"] : ["Fluindo", "text-emerald-700"];
                return (
                  <tr key={e.id} className={gargalo?.e.id === e.id ? "bg-amber-50/50" : ""}>
                    <td className="font-medium"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: corEtapa(etapas, e.id) }} />{e.nome}</td>
                    <td>{b.wip_inicio}</td><td>{b.entradas}</td><td>{b.saidas}{b.devolvidas ? <span className="text-xs text-slate-500"> ({b.devolvidas} devol.)</span> : null}</td>
                    <td className={saldo > 0 ? "font-semibold text-amber-700" : saldo < 0 ? "text-emerald-700" : ""}>{saldo > 0 ? `+${saldo}` : saldo}</td>
                    <td className="font-semibold">{b.wip}</td>
                    <td>{um(vazao)} /dia</td>
                    <td className={Number.isFinite(espera) && espera <= e.prazo_dias ? "" : "font-semibold text-red-600"}>{Number.isFinite(espera) ? dias(espera) : "sem saídas"}</td>
                    <td>{e.prazo_dias} dias</td>
                    <td className={`whitespace-nowrap text-xs font-semibold ${estado[1]}`}>{estado[0]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Cartao>

      <Cartao titulo="Estoque de NF por setor, dia a dia"
        descricao="Cada faixa é a quantidade de NF parada em um setor no fim do dia. Faixa que engorda = fila acumulando naquele setor; faixa estável = fluxo contínuo. Passe o mouse para ver os números do dia.">
        <div className="mb-3"><Legenda itens={[...series].reverse().map((s) => ({ cor: s.cor, nome: s.nome }))} /></div>
        <AreasEmpilhadas dias={diasLista} series={series} />
      </Cartao>

      <Cartao titulo="Chegadas × saídas por semana (últimas 26 semanas)"
        descricao="Chegadas = NF recebidas; saídas = NF finalizadas ou retiradas. Quando a linha de chegadas fica acima da de saídas, o estoque total cresce. A última semana é a atual, ainda em andamento.">
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Indicador titulo="Chegadas em 26 semanas" valor={chegadas} detalhe={`${um(chegadas / 26)} por semana`} />
          <Indicador titulo="Saídas em 26 semanas" valor={saidas} detalhe={`${um(saidas / 26)} por semana`} />
          <Indicador titulo="Saldo das últimas 4 semanas" valor={saldo4 > 0 ? `+${saldo4}` : saldo4} cor={saldo4 > 0 ? "text-amber-700" : "text-emerald-700"}
            detalhe={saldo4 > 0 ? "chegando mais do que saindo" : "saindo mais do que chegando"} />
          <Indicador titulo="NF em aberto hoje" valor={semanas[semanas.length - 1]?.estoque ?? 0} />
        </div>
        <div className="mb-2"><Legenda itens={[{ cor: CATEGORICAS[0], nome: "Chegadas", forma: "linha" }, { cor: CATEGORICAS[1], nome: "Saídas", forma: "linha" }]} /></div>
        <Linhas rotulos={semanas.map((s) => s.semana.slice(8, 10) + "/" + s.semana.slice(5, 7))}
          series={[{ nome: "Chegadas", cor: CATEGORICAS[0], valores: semanas.map((s) => s.chegadas) }, { nome: "Saídas", cor: CATEGORICAS[1], valores: semanas.map((s) => s.saidas) }]} />
        <p className="mt-4 mb-2 text-xs font-medium text-slate-500">NF em aberto no fim de cada semana</p>
        <Linhas rotulos={semanas.map((s) => s.semana.slice(8, 10) + "/" + s.semana.slice(5, 7))}
          series={[{ nome: "Em aberto", cor: COR.serie, valores: semanas.map((s) => s.estoque) }]} />
      </Cartao>
    </div>
  );
}

// ================================================================ Fila (FIFO) e envelhecimento

export async function AbaFila({ janela: jP }: { janela?: string }) {
  const janela = janelaValida(jP, [30, 60, 90, 180], 60);
  const [etapas, prazoReprov, fifo, ultra, idade] = await Promise.all([etapasAtivas(), prazoReprovada(), aderenciaFifo(janela), ultrapassadas(), envelhecimento()]);
  const tot = fifo.reduce((a, f) => ({ s: a.s + f.saidas, f: a.f + f.fora }), { s: 0, f: 0 });
  const linhasIdade = [...etapas.map((e) => ({ chave: e.id, nome: e.nome, prazo: e.prazo_dias })), { chave: 0, nome: "Reprovadas", prazo: prazoReprov }];
  const maxCel = Math.max(1, ...idade.map((x) => x.n));
  // faixa de idade em que o prazo do setor estoura
  const faixaDoPrazo = (prazo: number) => FAIXAS_IDADE.findIndex(([a, b]) => prazo > a && prazo <= b);

  return (
    <div className="space-y-5">
      <Janela aba="fila" atual={janela} opcoes={[30, 60, 90, 180]} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador titulo="Aderência à fila (FIFO)" valor={pct(tot.s - tot.f, tot.s)} detalhe={`${tot.s - tot.f} de ${tot.s} saídas respeitaram a ordem de chegada`}
          cor={tot.s && (tot.s - tot.f) / tot.s < 0.8 ? "text-amber-700" : "text-emerald-700"} />
        <Indicador titulo="Saídas fora de ordem" valor={tot.f} detalhe={`nos últimos ${janela} dias`} />
        <Indicador titulo="NF ultrapassadas agora" valor={ultra.length} detalhe="mais antigas, ainda paradas, com outras já despachadas na frente" cor={ultra.length ? "text-amber-700" : "text-slate-900"} />
        <Indicador titulo="Ultrapassadas 3+ vezes" valor={ultra.filter((u) => u.vezes >= 3).length} cor={ultra.some((u) => u.vezes >= 3) ? "text-red-600" : "text-slate-900"} />
      </div>

      <Cartao titulo="Aderência à fila única por setor"
        descricao="Uma saída é “fora de ordem” quando o setor despachou ou devolveu uma NF enquanto outra, que tinha chegado antes, continuava esperando. Há motivos legítimos (perícia laboratorial, pendência do fornecedor), mas o normal é a fila andar na ordem de chegada.">
        <div className="space-y-2.5">
          {etapas.map((e) => {
            const f = fifo.find((x) => x.etapa_id === e.id) ?? { saidas: 0, fora: 0 };
            const ader = f.saidas ? (f.saidas - f.fora) / f.saidas : null;
            return (
              <div key={e.id} className="grid grid-cols-[9rem_1fr_9rem] items-center gap-3 text-sm">
                <span className="truncate font-medium text-slate-700">{e.nome}</span>
                <span className="flex h-4 overflow-hidden rounded bg-slate-100" title={ader === null ? "Sem saídas" : `${f.saidas - f.fora} na ordem · ${f.fora} fora de ordem`}>
                  {ader !== null && <>
                    <span style={{ width: `${ader * 100}%`, background: COR.bom }} />
                    <span style={{ width: `${(1 - ader) * 100}%`, background: COR.atencao }} className="border-l-2 border-white" />
                  </>}
                </span>
                <span className="text-right text-xs text-slate-600"><strong className="text-sm text-slate-900">{ader === null ? "—" : pct(f.saidas - f.fora, f.saidas)}</strong> · {f.fora} de {f.saidas} fora</span>
              </div>
            );
          })}
        </div>
        <div className="mt-3"><Legenda itens={[{ cor: COR.bom, nome: "Saiu na ordem de chegada" }, { cor: COR.atencao, nome: "Saiu na frente de NF mais antiga" }]} /></div>
      </Cartao>

      <Cartao titulo="NF ultrapassadas na fila"
        descricao="NF que estão hoje no setor e já viram outras, que chegaram depois delas, saírem primeiro. Se houver impedimento, registre-o como observação na NF.">
        {ultra.length === 0 ? <p className="text-sm text-slate-500">Nenhuma NF ultrapassada. A fila está andando na ordem.</p> : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>NF</th><th>Empresa</th><th>Setor</th><th>Chegou ao setor</th><th>Parada há</th><th>Ultrapassada por</th></tr></thead>
              <tbody>
                {ultra.slice(0, 50).map((u) => (
                  <tr key={u.id}>
                    <td><Link href={`/notas/${u.id}`} className="font-semibold text-marinha hover:underline">{u.numero}</Link></td>
                    <td className="max-w-64 truncate">{u.emit_nome}</td><td>{u.etapa}</td><td>{data(u.entrada)}</td><td>{dias(u.dias)}</td>
                    <td className={u.vezes >= 3 ? "font-semibold text-red-600" : "font-semibold text-amber-700"}>{u.vezes} NF</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>

      <Cartao titulo="Envelhecimento da fila"
        descricao="Quantas NF estão paradas em cada setor, por tempo de espera. Quanto mais escura a célula, mais NF. A borda vermelha marca a faixa em que o prazo do setor estoura: tudo à direita dela já está atrasado.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="px-2 py-2 text-left font-medium">Setor</th>
                {FAIXAS_IDADE.map(([, , nome]) => <th key={nome} className="px-2 py-2 text-center font-medium">{nome}</th>)}
                <th className="px-2 py-2 text-center font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {linhasIdade.map((l) => {
                const cel = FAIXAS_IDADE.map((_, i) => idade.find((x) => x.chave === l.chave && x.faixa === i)?.n ?? 0);
                const total = cel.reduce((a, b) => a + b, 0);
                const fp = faixaDoPrazo(l.prazo);
                return (
                  <tr key={l.chave}>
                    <td className="whitespace-nowrap px-2 py-1 font-medium text-slate-700">{l.nome} <span className="text-xs font-normal text-slate-400">({l.prazo}d)</span></td>
                    {cel.map((n, i) => {
                      const t = n / maxCel;
                      return (
                        <td key={i} className="p-0.5">
                          <div title={`${l.nome} · ${FAIXAS_IDADE[i][2]}: ${n} NF`}
                            className={`flex h-9 items-center justify-center rounded text-sm tabular-nums ${i === fp ? "ring-2 ring-inset ring-red-400" : ""}`}
                            style={{ background: n ? `rgba(20, 48, 107, ${0.08 + t * 0.82})` : "#f8fafc", color: t > 0.45 ? "#fff" : "#0f172a" }}>
                            {n || ""}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-2 text-center font-semibold">{total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Cartao>
    </div>
  );
}

// ================================================================ Previsão

export async function AbaPrevisao() {
  const etapas = await etapasAtivas();
  const { lista, prazoTotal, tipicos } = await previsoes(etapas);
  const faixas: [string, number, number][] = [["Próximos 7 dias", 0, 7], ["8 a 15 dias", 7, 15], ["16 a 30 dias", 15, 30], ["Mais de 30 dias", 30, 1e9]];
  const ultima = etapas[etapas.length - 1];
  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-600">
        Previsão de finalização de cada NF em trâmite, somando o tempo típico (mediana dos últimos 180 dias) das etapas que ainda faltam.
        Serve para planejar a carga de trabalho{ultima ? ` do ${ultima.nome}` : ""} e antecipar atrasos. NF reprovadas não entram.
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {faixas.map(([nome, a, b]) => {
          const n = lista.filter((p) => p.restante > a && p.restante <= b);
          return <Indicador key={nome} titulo={`Devem finalizar: ${nome.toLowerCase()}`} valor={n.length} detalhe={moeda(n.reduce((s, p) => s + Number(p.valor), 0))} />;
        })}
      </div>
      <Cartao titulo="Tempo típico de cada etapa" descricao={`Soma dos prazos do caminho: ${prazoTotal} dias. Soma dos tempos típicos: ${um(tipicos.reduce((s, t) => s + t.dias, 0))} dias.`}>
        <div className="flex flex-wrap gap-2 text-sm">
          {tipicos.map((t) => (
            <span key={t.etapa.id} className="rounded-lg border border-slate-200 px-3 py-1.5">
              <span className="text-slate-500">{t.etapa.nome}:</span> <strong>{dias(t.dias)}</strong>
              <span className={`ml-1 text-xs ${t.dias > t.etapa.prazo_dias ? "text-red-600" : "text-slate-400"}`}>(prazo {t.etapa.prazo_dias}){t.temHistorico ? "" : " · sem histórico, usando o prazo"}</span>
            </span>
          ))}
        </div>
      </Cartao>
      <Cartao titulo="Previsão por NF" descricao="Em ordem de data prevista. Em vermelho, NF cujo tempo total previsto passa da soma dos prazos do caminho.">
        {lista.length === 0 ? <p className="text-sm text-slate-500">Nenhuma NF em trâmite.</p> : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>NF</th><th>Empresa</th><th>Setor atual</th><th>No setor há</th><th>Faltam (previsão)</th><th>Finalização prevista</th><th>Tempo total previsto</th><th className="text-right">Valor</th></tr></thead>
              <tbody>
                {lista.slice(0, 150).map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/notas/${p.id}`} className="font-semibold text-marinha hover:underline">{p.numero}</Link></td>
                    <td className="max-w-60 truncate">{p.emit_nome}</td>
                    <td>{p.etapa}</td><td>{dias(p.dias_etapa)}</td><td>{dias(p.restante)}</td>
                    <td className="whitespace-nowrap font-medium">{data(p.prevista)}</td>
                    <td className={p.estoura ? "font-semibold text-red-600" : ""}>{dias(p.total_previsto)}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{moeda(p.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lista.length > 150 && <p className="mt-2 text-xs text-slate-500">Mostrando as 150 primeiras de {lista.length}.</p>}
          </div>
        )}
      </Cartao>
    </div>
  );
}

// ================================================================ Retrabalho

export async function AbaRetrabalho({ janela: jP }: { janela?: string }) {
  const janela = janelaValida(jP, [30, 90, 180, 365], 90);
  const [etapas, r] = await Promise.all([etapasAtivas(), retrabalho(janela)]);
  const tot = r.porEtapa.reduce((a, x) => ({ s: a.s + x.saidas, d: a.d + x.devolvidas, rp: a.rp + x.reprovadas }), { s: 0, d: 0, rp: 0 });
  return (
    <div className="space-y-5">
      <Janela aba="retrabalho" atual={janela} opcoes={[30, 90, 180, 365]} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador titulo="Finalizadas de primeira" valor={pct(r.geral.de_primeira, r.geral.finalizadas)}
          detalhe={`${r.geral.de_primeira} de ${r.geral.finalizadas} NF finalizadas sem nenhuma devolução ou reprovação`} cor="text-emerald-700" />
        <Indicador titulo="Devoluções" valor={tot.d} detalhe={`${pct(tot.d, tot.s, 1)} das saídas dos setores`} cor={tot.d ? "text-amber-700" : "text-slate-900"} />
        <Indicador titulo="Reprovações" valor={tot.rp} detalhe={`${pct(tot.rp, tot.s, 1)} das saídas dos setores`} cor={tot.rp ? "text-red-600" : "text-slate-900"} />
        <Indicador titulo="NF com idas e voltas" valor={r.idasVoltas.length} detalhe="2 ou mais devoluções/reprovações" />
      </div>
      <Cartao titulo="Retrabalho por setor" descricao={`Nos últimos ${janela} dias. Devolução = NF enviada de volta à etapa anterior. Um setor que devolve muito pode indicar falha na etapa anterior ou falta de padrão na conferência.`}>
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead><tr><th>Setor</th><th>Saídas</th><th>Devolvidas à etapa anterior</th><th>% devolução</th><th>Reprovadas</th><th>% reprovação</th><th className="w-1/4"></th></tr></thead>
            <tbody>
              {etapas.map((e) => {
                const x = r.porEtapa.find((p) => p.etapa_id === e.id) ?? { saidas: 0, devolvidas: 0, reprovadas: 0 };
                const taxa = x.saidas ? (x.devolvidas + x.reprovadas) / x.saidas : 0;
                return (
                  <tr key={e.id}>
                    <td className="font-medium">{e.nome}</td><td>{x.saidas}</td><td>{x.devolvidas}</td><td>{pct(x.devolvidas, x.saidas, 1)}</td>
                    <td>{x.reprovadas}</td><td>{pct(x.reprovadas, x.saidas, 1)}</td>
                    <td>
                      <span className="flex h-2.5 overflow-hidden rounded-full bg-slate-100" title={`${pct(x.devolvidas + x.reprovadas, x.saidas, 1)} de retrabalho`}>
                        <span style={{ width: `${(x.saidas ? x.devolvidas / x.saidas : 0) * 100}%`, background: COR.atencao }} />
                        <span style={{ width: `${(x.saidas ? x.reprovadas / x.saidas : 0) * 100}%`, background: COR.critico }} />
                      </span>
                      <span className="text-[11px] text-slate-500">{taxa ? pct(x.devolvidas + x.reprovadas, x.saidas, 1) : ""}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3"><Legenda itens={[{ cor: COR.atencao, nome: "Devoluções" }, { cor: COR.critico, nome: "Reprovações" }]} /></div>
      </Cartao>
      <Cartao titulo="NF com idas e voltas" descricao="NF que tiveram 2 ou mais devoluções ou reprovações, com o caminho completo percorrido.">
        {r.idasVoltas.length === 0 ? <p className="text-sm text-slate-500">Nenhuma NF com idas e voltas no período.</p> : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>NF</th><th>Empresa</th><th>Devoluções</th><th>Reprovações</th><th>Caminho percorrido</th></tr></thead>
              <tbody>
                {r.idasVoltas.map((n) => (
                  <tr key={n.id}>
                    <td><Link href={`/notas/${n.id}`} className="font-semibold text-marinha hover:underline">{n.numero}</Link></td>
                    <td className="max-w-56 truncate">{n.emit_nome}</td><td>{n.devolucoes}</td><td>{n.reprovacoes}</td>
                    <td className="text-xs text-slate-600">{n.caminho}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
    </div>
  );
}
