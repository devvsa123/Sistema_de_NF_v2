import type { ReactNode } from "react";

/** Gráficos simples em SVG/HTML, renderizados no servidor. Passe o mouse para ver os valores. */

export const COR = {
  serie: "#1a237e",
  faixa: "rgba(26, 35, 126, 0.14)",
  grade: "#e5e7eb",
  eixo: "#64748b",
  fimDeSemana: "#f1f5f9",
  // status (com rótulo sempre visível; nunca apenas a cor)
  bom: "#0ca30c",
  atencao: "#fab219",
  critico: "#d03b3b",
};

const fmt = (v: number, casas = 1) => v.toLocaleString("pt-BR", { maximumFractionDigits: casas });

/** Escala "bonita" para o eixo Y. */
function marcas(max: number, qtd = 4) {
  if (max <= 0) return { topo: 1, passos: [0, 1] };
  const bruto = max / qtd;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= bruto)!;
  const topo = Math.ceil(max / passo) * passo;
  const passos: number[] = [];
  for (let v = 0; v <= topo + 1e-9; v += passo) passos.push(Number(v.toFixed(6)));
  return { topo, passos };
}

export function Legenda({ itens }: { itens: { cor: string; nome: string; forma?: "quadrado" | "linha" | "faixa" }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {itens.map((i) => (
        <span key={i.nome} className="inline-flex items-center gap-1.5">
          {i.forma === "linha" ? (
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: i.cor }} />
          ) : (
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.cor }} />
          )}
          {i.nome}
        </span>
      ))}
    </div>
  );
}

/** Barras horizontais empilhadas (ex.: NF em cada setor por situação de prazo). */
export function BarrasEmpilhadas({
  linhas, legenda,
}: {
  linhas: { rotulo: ReactNode; total: number; partes: { valor: number; cor: string; nome: string }[]; detalhe?: ReactNode }[];
  legenda: { cor: string; nome: string }[];
}) {
  const max = Math.max(1, ...linhas.map((l) => l.total));
  return (
    <div className="space-y-3">
      <Legenda itens={legenda} />
      <div className="space-y-2">
        {linhas.map((l, i) => (
          <div key={i} className="grid grid-cols-[9rem_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate font-medium text-slate-700">{l.rotulo}</span>
            <div className="flex h-5 gap-[2px]" style={{ width: `${Math.max(l.total ? 2 : 0, (l.total / max) * 100)}%` }}>
              {l.partes.filter((p) => p.valor > 0).map((p) => (
                <span
                  key={p.nome}
                  title={`${p.nome}: ${p.valor} NF`}
                  className="h-full first:rounded-l last:rounded-r"
                  style={{ background: p.cor, flexGrow: p.valor, minWidth: 3 }}
                />
              ))}
            </div>
            <span className="whitespace-nowrap text-right text-xs tabular-nums text-slate-600">
              <strong className="text-sm text-slate-800">{l.total}</strong> {l.detalhe}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Linha da média mensal com faixa entre o 1º e o 3º quartil. */
export function LinhaComFaixa({
  pontos, unidade = "dias", limite,
}: {
  pontos: { rotulo: string; valor: number; faixa?: [number, number]; detalhe?: string }[];
  unidade?: string;
  limite?: { valor: number; nome: string };
}) {
  const W = 760, H = 260, m = { t: 16, r: 56, b: 32, l: 44 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const max = Math.max(1, ...pontos.map((p) => Math.max(p.valor, p.faixa?.[1] ?? 0)), limite?.valor ?? 0);
  const { topo, passos } = marcas(max);
  const x = (i: number) => m.l + (pontos.length === 1 ? iw / 2 : (i / (pontos.length - 1)) * iw);
  const y = (v: number) => m.t + ih - (v / topo) * ih;
  const caminho = pontos.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(" ");
  const comFaixa = pontos.filter((p) => p.faixa);
  const faixa = comFaixa.length > 1
    ? pontos.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.faixa![1]).toFixed(1)}`).join(" ") +
      " " + [...pontos].reverse().map((p, k) => `L${x(pontos.length - 1 - k).toFixed(1)},${y(p.faixa![0]).toFixed(1)}`).join(" ") + " Z"
    : "";
  const passoRotulo = Math.max(1, Math.ceil(pontos.length / 12));
  const ultimo = pontos.length - 1;
  const largura = pontos.length > 1 ? iw / (pontos.length - 1) : iw;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Evolução mensal do tempo médio">
      {passos.map((v) => (
        <g key={v}>
          <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke={COR.grade} strokeWidth={1} />
          <text x={m.l - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill={COR.eixo}>{fmt(v, 0)}</text>
        </g>
      ))}
      {limite && limite.valor <= topo && (
        <g>
          <line x1={m.l} x2={W - m.r} y1={y(limite.valor)} y2={y(limite.valor)} stroke={COR.critico} strokeWidth={1} strokeDasharray="4 4" />
          <text x={W - m.r + 4} y={y(limite.valor) + 4} fontSize={11} fill={COR.critico}>{limite.nome}</text>
        </g>
      )}
      {faixa && <path d={faixa} fill={COR.faixa} />}
      <path d={caminho} fill="none" stroke={COR.serie} strokeWidth={2} strokeLinejoin="round" />
      {pontos.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.valor)} r={4} fill={COR.serie} stroke="#fff" strokeWidth={2} />
          {i % passoRotulo === 0 || i === ultimo ? (
            <text x={x(i)} y={H - 10} textAnchor="middle" fontSize={11} fill={COR.eixo}>{p.rotulo}</text>
          ) : null}
          <rect x={x(i) - largura / 2} y={m.t} width={largura} height={ih} fill="transparent">
            <title>{`${p.rotulo}: média ${fmt(p.valor)} ${unidade}${p.faixa ? ` · 25%–75%: ${fmt(p.faixa[0])} a ${fmt(p.faixa[1])}` : ""}${p.detalhe ? ` · ${p.detalhe}` : ""}`}</title>
          </rect>
        </g>
      ))}
      {pontos.length > 0 && (
        <text x={x(ultimo)} y={y(pontos[ultimo].valor) - 10} textAnchor="middle" fontSize={12} fontWeight={600} fill="#1f2430">{fmt(pontos[ultimo].valor)}</text>
      )}
    </svg>
  );
}

/** Colunas por dia, com fins de semana sombreados. */
export function ColunasDiarias({ dias, unidade = "NF" }: { dias: { data: string; valor: number; fimDeSemana: boolean }[]; unidade?: string }) {
  const W = 760, H = 170, m = { t: 18, r: 8, b: 26, l: 32 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const max = Math.max(1, ...dias.map((d) => d.valor));
  const { topo, passos } = marcas(max, 3);
  const passoX = iw / Math.max(1, dias.length);
  const lb = Math.max(1, Math.min(passoX - 2, 22));
  const y = (v: number) => m.t + ih - (v / topo) * ih;
  const iMax = dias.reduce((b, d, i) => (d.valor > dias[b].valor ? i : b), 0);
  const cada = Math.max(1, Math.ceil(dias.length / 10));
  const rot = (d: string) => d.slice(8, 10) + "/" + d.slice(5, 7);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="NF tramitadas por dia">
      {dias.map((d, i) => d.fimDeSemana && <rect key={"f" + i} x={m.l + i * passoX} y={m.t} width={passoX} height={ih} fill={COR.fimDeSemana} />)}
      {passos.map((v) => (
        <g key={v}>
          <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke={COR.grade} />
          <text x={m.l - 5} y={y(v) + 4} textAnchor="end" fontSize={10} fill={COR.eixo}>{fmt(v, 0)}</text>
        </g>
      ))}
      {dias.map((d, i) => {
        const cx = m.l + i * passoX + passoX / 2;
        const h = (d.valor / topo) * ih;
        return (
          <g key={i}>
            {d.valor > 0 && <rect x={cx - lb / 2} y={m.t + ih - h} width={lb} height={h} rx={Math.min(3, lb / 3)} fill={d.fimDeSemana ? "#94a3b8" : COR.serie} />}
            {i === iMax && d.valor > 0 && <text x={cx} y={m.t + ih - h - 5} textAnchor="middle" fontSize={11} fontWeight={600} fill="#1f2430">{d.valor}</text>}
            {i % cada === 0 && <text x={cx} y={H - 8} textAnchor="middle" fontSize={10} fill={COR.eixo}>{rot(d.data)}</text>}
            <rect x={m.l + i * passoX} y={m.t} width={passoX} height={ih} fill="transparent">
              <title>{`${rot(d.data)}${d.fimDeSemana ? " (fim de semana)" : ""}: ${d.valor} ${unidade}`}</title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
}
