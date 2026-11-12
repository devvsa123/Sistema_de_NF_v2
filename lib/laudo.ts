import "server-only";
import { sql } from "./db";
import type { Usuario } from "./auth";
import { etapasDoUsuario, type Etapa } from "./fluxo";
import { cnpj, data } from "./format";
import { marcadoresDoModelo, preencherDocx } from "./docx";

export const MODELO = "laudo_pericial";
export const MODELO_PADRAO = "laudo_pericial_padrao";

/** Marcadores preenchidos automaticamente ou pelo perito. Os campos fixos (Diretor etc.) ficam em `config`. */
export const MARCADORES: { chave: string; descricao: string; origem: "NF" | "Perito" }[] = [
  { chave: "numero_nf", descricao: "Número da NF", origem: "NF" },
  { chave: "numero_oc", descricao: "Número da OC", origem: "NF" },
  { chave: "cnpj", descricao: "CNPJ da empresa", origem: "NF" },
  { chave: "nome_empresa", descricao: "Nome da empresa", origem: "NF" },
  { chave: "valor_nf", descricao: "Valor total da NF", origem: "NF" },
  { chave: "chave_acesso", descricao: "Chave de acesso da NF-e", origem: "NF" },
  { chave: "data_pericia", descricao: "Data de entrada na perícia", origem: "NF" },
  { chave: "data_emissao_laudo", descricao: "Data em que o laudo foi emitido", origem: "NF" },
  { chave: "perito", descricao: "Nome de quem emitiu o laudo", origem: "NF" },
  { chave: "protocolo", descricao: "Número do protocolo", origem: "Perito" },
  { chave: "lote", descricao: "Lote", origem: "Perito" },
  { chave: "fabricacao", descricao: "Fabricação", origem: "Perito" },
  { chave: "resultado_visual", descricao: "Resultado da perícia visual", origem: "Perito" },
  { chave: "medidas", descricao: "Medidas conforme a especificação (Sim / Não – explicação)", origem: "Perito" },
  { chave: "obs_visual", descricao: "Observações da perícia visual", origem: "Perito" },
  { chave: "resultado_laboratorial", descricao: "Resultado da perícia laboratorial", origem: "Perito" },
  { chave: "numero_oficio", descricao: "Número do ofício ao SENAI", origem: "Perito" },
  { chave: "data_envio", descricao: "Data de envio ao laboratório", origem: "Perito" },
  { chave: "data_recebimento", descricao: "Data de recebimento do laboratório", origem: "Perito" },
  { chave: "obs_laboratorial", descricao: "Observações da perícia laboratorial", origem: "Perito" },
];

/** Marcadores do modelo do sistema antigo (@#...), aceitos para quem enviar aquele arquivo. */
const LEGADO: Record<string, string> = {
  "@#numeronf": "numero_nf", "@#numerooc": "numero_oc", "@#datapericia": "data_pericia", "@#cnpj": "cnpj", "@#nomeempresa": "nome_empresa",
  "@#protocolo": "protocolo", "@#lote": "lote", "@#fabricação": "fabricacao", "@#resultadopericiavisual": "resultado_visual",
  "@#respostamedidas": "medidas", "@#discrepânciasvisual": "obs_visual", "@#resultadopericialaboratorial": "resultado_laboratorial",
  "@#numerooficio": "numero_oficio", "@#discrepânciaslaboratorial": "obs_laboratorial", "@#dataenvio": "data_envio", "@#datarecebimento": "data_recebimento",
};
const comLegado = (v: Record<string, string>) => ({ ...v, ...Object.fromEntries(Object.entries(LEGADO).map(([a, b]) => [a, v[b] ?? ""])) });

export type CampoFixo = { chave: string; rotulo: string; valor: string };

export async function camposFixos(): Promise<CampoFixo[]> {
  const [r] = await sql`select valor from config where chave = 'laudo_campos'`;
  try {
    const lista = JSON.parse(r?.valor ?? "[]");
    return Array.isArray(lista) ? lista.filter((c) => c && typeof c.chave === "string") : [];
  } catch {
    return [];
  }
}

export const CHAVE_VALIDA = /^[a-z][a-z0-9_]{1,39}$/;

export async function salvarCamposFixos(campos: CampoFixo[]) {
  const reservadas = new Set(MARCADORES.map((m) => m.chave));
  const vistas = new Set<string>();
  for (const c of campos) {
    if (!CHAVE_VALIDA.test(c.chave)) throw new Error(`Marcador inválido: “${c.chave}”. Use letras minúsculas, números e _ (ex.: encarregado_nome).`);
    if (reservadas.has(c.chave)) throw new Error(`O marcador “${c.chave}” já é preenchido automaticamente; escolha outro nome.`);
    if (vistas.has(c.chave)) throw new Error(`O marcador “${c.chave}” aparece duas vezes.`);
    vistas.add(c.chave);
  }
  await sql`insert into config (chave, valor) values ('laudo_campos', ${JSON.stringify(campos)})
            on conflict (chave) do update set valor = excluded.valor`;
}

export async function modeloAtual(chave = MODELO) {
  const [r] = await sql`select arquivo, nome_arquivo, atualizado_em, atualizado_por,
                               (select nome from usuarios where id = atualizado_por) as atualizado_por_nome
                        from modelos where chave = ${chave}`;
  if (!r) throw new Error("Modelo do laudo não encontrado.");
  return { arquivo: new Uint8Array(r.arquivo as Buffer), nome: r.nome_arquivo as string, atualizadoEm: r.atualizado_em as Date, por: r.atualizado_por_nome as string | null };
}

export function analisarModelo(arquivo: Uint8Array, fixos: CampoFixo[]) {
  const achados = marcadoresDoModelo(arquivo);
  const conhecidos = new Set([...MARCADORES.map((m) => m.chave), ...fixos.map((f) => f.chave), ...Object.keys(LEGADO)]);
  return { achados, desconhecidos: achados.filter((a) => !conhecidos.has(a.toLowerCase())) };
}

export async function salvarModelo(u: Usuario, arquivo: Uint8Array, nome: string) {
  marcadoresDoModelo(arquivo); // valida o arquivo
  await sql`update modelos set arquivo = ${Buffer.from(arquivo)}, nome_arquivo = ${nome}, atualizado_em = now(), atualizado_por = ${u.id}
            where chave = ${MODELO}`;
}

export async function restaurarModeloPadrao(u: Usuario) {
  await sql`update modelos m set arquivo = p.arquivo, nome_arquivo = p.nome_arquivo, atualizado_em = now(), atualizado_por = ${u.id}
            from modelos p where m.chave = ${MODELO} and p.chave = ${MODELO_PADRAO}`;
}

/** Somente os usuários vinculados à etapa que emite laudo (a Perícia). */
export function podeEmitirLaudo(u: Usuario, etapas: Etapa[]) {
  return u.papel === "interno" && etapasDoUsuario(u, etapas).some((e) => e.emite_laudo);
}

export type DadosLaudo = {
  protocolo: string; lote: string; fabricacao: string; resultado_visual: string; medidas: string; medidas_explicacao: string;
  obs_visual: string; resultado_laboratorial: string; numero_oficio: string; data_envio: string; data_recebimento: string; obs_laboratorial: string;
};

export const RESULTADOS_VISUAL = ["Aprovado", "Aceitável", "Reprovado"];
export const RESULTADOS_LAB = ["Aprovado", "Aceitável", "Reprovado", "Não se aplica"];

export function validarDados(d: DadosLaudo): string | null {
  if (!d.protocolo.trim()) return "Informe o número do protocolo.";
  if (!RESULTADOS_VISUAL.includes(d.resultado_visual)) return "Escolha o resultado da perícia visual.";
  if (!RESULTADOS_LAB.includes(d.resultado_laboratorial)) return "Escolha o resultado da perícia laboratorial.";
  if (d.medidas !== "Sim" && d.medidas !== "Não") return "Informe se as medidas estão de acordo.";
  if (d.medidas === "Não" && !d.medidas_explicacao.trim()) return "Explique por que as medidas não estão de acordo.";
  if (d.obs_visual.length > 300 || d.obs_laboratorial.length > 300) return "As observações têm no máximo 300 caracteres (limite do espaço no laudo).";
  return null;
}

/** Dados da NF usados no laudo. */
export async function nfDoLaudo(notaId: number) {
  const [n] = await sql`
    select n.id, n.numero, n.oc, n.emit_cnpj, n.emit_nome, n.valor, n.chave, n.status, n.etapa_id,
           (select max(ev.criado_em) from eventos ev join etapas e on e.id = ev.para_etapa_id
             where ev.nota_id = n.id and ev.movimento and ev.para_status = 'em_tramite' and e.emite_laudo) as entrada_pericia
    from notas n where n.id = ${notaId}`;
  return n as { id: number; numero: string; oc: string | null; emit_cnpj: string; emit_nome: string; valor: string; chave: string | null; entrada_pericia: Date | null } | undefined;
}

const dataBR = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : iso);
const moedaBR = (v: string | number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Registra o laudo, guardando também os campos fixos vigentes (o laudo continua igual mesmo se o Diretor mudar depois). */
export async function emitirLaudo(u: Usuario, notaId: number, d: DadosLaudo) {
  const nf = await nfDoLaudo(notaId);
  if (!nf) throw new Error("NF não encontrada.");
  const fixos = await camposFixos();
  const naoSeAplica = (v: string) => v.trim() || "Não se aplica";
  const valores: Record<string, string> = {
    numero_nf: nf.numero, numero_oc: nf.oc ?? "", cnpj: cnpj(nf.emit_cnpj), nome_empresa: nf.emit_nome, valor_nf: moedaBR(nf.valor),
    chave_acesso: nf.chave ?? "", data_pericia: nf.entrada_pericia ? data(nf.entrada_pericia) : "", data_emissao_laudo: data(new Date()), perito: u.nome,
    protocolo: d.protocolo.trim(), lote: d.lote.trim(), fabricacao: d.fabricacao.trim(), resultado_visual: d.resultado_visual,
    medidas: d.medidas === "Sim" ? "Sim" : `Não – ${d.medidas_explicacao.trim()}`, obs_visual: d.obs_visual.trim(),
    resultado_laboratorial: d.resultado_laboratorial,
    numero_oficio: naoSeAplica(d.numero_oficio), data_envio: naoSeAplica(dataBR(d.data_envio)), data_recebimento: naoSeAplica(dataBR(d.data_recebimento)),
    obs_laboratorial: d.obs_laboratorial.trim(),
    ...Object.fromEntries(fixos.map((f) => [f.chave, f.valor])),
  };
  return sql.begin(async (tx) => {
    const [l] = await tx`insert into laudos (nota_id, protocolo, dados, criado_por) values (${notaId}, ${valores.protocolo},
                          ${tx.json({ formulario: d, valores } as never)}, ${u.id}) returning id`;
    await tx`insert into eventos (nota_id, tipo, usuario_id, usuario_nome, texto)
             values (${notaId}, 'laudo', ${u.id}, ${u.nome}, ${`Laudo pericial emitido · protocolo ${valores.protocolo} · visual: ${d.resultado_visual} · laboratorial: ${d.resultado_laboratorial}`})`;
    return l.id as number;
  });
}

export async function laudosDaNota(notaId: number) {
  return sql<{ id: number; protocolo: string | null; criado_em: Date; por: string | null; dados: { formulario: DadosLaudo } }[]>`
    select l.id, l.protocolo, l.criado_em, u.nome as por, l.dados from laudos l left join usuarios u on u.id = l.criado_por
    where l.nota_id = ${notaId} order by l.criado_em desc`;
}

/** Gera o .docx de um laudo já emitido, com o modelo atual. */
export async function documentoDoLaudo(laudoId: number) {
  const [l] = await sql`select l.dados, n.numero from laudos l join notas n on n.id = l.nota_id where l.id = ${laudoId}`;
  if (!l) return null;
  const { arquivo } = await modeloAtual();
  const valores = (l.dados as { valores: Record<string, string> }).valores;
  return { bytes: preencherDocx(arquivo, comLegado(valores)), nome: `laudo-pericial-NF${String(l.numero).replace(/\W/g, "")}-${(valores.protocolo || laudoId).toString().replace(/[^\w-]/g, "_")}.docx` };
}

/** Exemplo preenchido com dados fictícios, para conferir um modelo novo. */
export async function exemploDoModelo() {
  const [{ arquivo }, fixos] = await Promise.all([modeloAtual(), camposFixos()]);
  const exemplo: Record<string, string> = {
    numero_nf: "12345", numero_oc: "1180000", cnpj: "00.000.000/0001-00", nome_empresa: "EMPRESA EXEMPLO LTDA", valor_nf: "R$ 100.000,00",
    chave_acesso: "33260000000000000100550010000123451000000000", data_pericia: data(new Date()), data_emissao_laudo: data(new Date()), perito: "Nome do Perito",
    protocolo: "001/2026", lote: "LOTE 01", fabricacao: "10/2026", resultado_visual: "Aprovado", medidas: "Sim", obs_visual: "Observação de exemplo da perícia visual.",
    resultado_laboratorial: "Não se aplica", numero_oficio: "Não se aplica", data_envio: "Não se aplica", data_recebimento: "Não se aplica", obs_laboratorial: "",
    ...Object.fromEntries(fixos.map((f) => [f.chave, f.valor])),
  };
  return preencherDocx(arquivo, comLegado(exemplo));
}
