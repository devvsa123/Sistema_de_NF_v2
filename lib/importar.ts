import "server-only";
import { sql } from "./db";
import { soDigitos } from "./format";
import { textoBusca } from "./nfe";
import type { Etapa } from "./fluxo";

/** Importação dos dados da planilha do sistema antigo (abas "Login" e "BancoDeDados"). */

export type Celula = string | number | null;
export type Linha = Record<string, Celula>;
export type ResultadoImportacao = { importadas: number; ignoradas: number; erros: string[] };

const s = (v: Celula | undefined) => String(v ?? "").trim();
const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Datas da planilha: "dd/mm/aaaa", "dd/mm/aaaa hh:mm" ou número serial do Excel. Horário de Brasília. */
function lerData(v: Celula | undefined, horaPadrao = "12:00"): Date | null {
  if (typeof v === "number" && v > 20000 && v < 90000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return new Date(`${d.toISOString().slice(0, 10)}T${horaPadrao}:00-03:00`);
  }
  const m = s(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const hora = m[4] ? `${m[4].padStart(2, "0")}:${m[5]}` : horaPadrao;
  const d = new Date(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T${hora}:00-03:00`);
  return isNaN(d.getTime()) ? null : d;
}

function lerValor(v: Celula | undefined): number {
  if (typeof v === "number") return v;
  const t = s(v).replace(/[R$\s]/g, "");
  const n = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
  return isFinite(n) ? n : 0;
}

// ---------- Usuários ----------

const PERFIL_ETAPAS: Record<string, string[]> = {
  recebimento: ["pre recebimento", "contagem"],
  pericia: ["pericia"],
  "enc. tecnica": ["enc. tecnica"],
  estocagem: ["estocagem"],
  controle: ["controle"],
};

export async function importarUsuarios(linhas: Linha[]): Promise<ResultadoImportacao> {
  const etapas = await sql<Etapa[]>`select * from etapas where ativo`;
  const r: ResultadoImportacao = { importadas: 0, ignoradas: 0, erros: [] };
  for (const l of linhas) {
    const login = soDigitos(s(l.usuario));
    const nome = s(l.nome);
    if (!login || !nome) { r.ignoradas++; continue; }
    try {
      const perfis = s(l.perfil).split(",").map(semAcento).filter(Boolean);
      const interno = perfis.some((p) => p in PERFIL_ETAPAS || p === "secom");
      const papel = perfis.includes("admin") ? "admin" : interno ? "interno" : perfis.includes("comrj") ? "consulta" : perfis.includes("empresa") ? "empresa" : null;
      if (!papel) { r.erros.push(`${nome}: perfil "${s(l.perfil)}" não reconhecido.`); continue; }
      const nomesEtapas = perfis.flatMap((p) => PERFIL_ETAPAS[p] ?? []);
      const ids = etapas.filter((e) => nomesEtapas.includes(semAcento(e.nome))).map((e) => e.id);
      const hash = s(l.senha).toLowerCase();
      const criado = await sql.begin(async (tx) => {
        if (papel === "empresa") await tx`insert into empresas (cnpj, nome) values (${login}, ${nome}) on conflict (cnpj) do nothing`;
        const [u] = await tx`insert into usuarios (login, nome, senha_legado_sha256, papel, empresa_cnpj, pode_cadastrar, trata_reprovadas, deve_trocar_senha)
          values (${login}, ${nome}, ${/^[0-9a-f]{64}$/.test(hash) ? hash : null}, ${papel}, ${papel === "empresa" ? login : null},
                  ${perfis.includes("secom")}, ${perfis.includes("recebimento")}, true)
          on conflict (login) do nothing returning id`;
        if (!u) return false;
        for (const id of ids) await tx`insert into usuario_etapas (usuario_id, etapa_id) values (${u.id}, ${id})`;
        return true;
      });
      if (criado) r.importadas++; else r.ignoradas++;
    } catch (e) {
      r.erros.push(`${nome}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return r;
}

// ---------- Notas ----------

type Ev = {
  tipo: string; movimento: boolean; de_nome: string | null; para_etapa_id: number | null; para_status: string | null;
  para_nome: string | null; usuario_nome: string | null; texto: string | null; criado_em: Date;
};

const STATUS_POR_NOME: Record<string, string> = {
  finalizada: "finalizada", reprovada: "reprovada", "retirada pelo fornecedor": "retirada", arquivada: "arquivada",
};
const TIPO_POR_STATUS: Record<string, string> = { finalizada: "finalizacao", reprovada: "reprovacao", retirada: "retirada", arquivada: "ajuste" };

export async function importarNotas(linhas: Linha[]): Promise<ResultadoImportacao> {
  const etapas = await sql<Etapa[]>`select * from etapas where ativo order by ordem, id`;
  const porNome = new Map(etapas.map((e) => [semAcento(e.nome), e]));
  const etapaReprova = etapas.find((e) => e.permite_reprovar) ?? etapas[0];
  const r: ResultadoImportacao = { importadas: 0, ignoradas: 0, erros: [] };

  /** Converte um nome da planilha ("Perícia", "Finalizada"...) em etapa/situação. */
  const destino = (nome: string, etapaAnterior: number | null) => {
    const k = semAcento(nome);
    const st = STATUS_POR_NOME[k];
    if (st) return { status: st, etapa_id: st === "reprovada" ? (etapaAnterior ?? etapaReprova?.id ?? null) : null, nome: nome.trim() };
    const e = porNome.get(k);
    return { status: "em_tramite", etapa_id: e?.id ?? null, nome: e?.nome ?? nome.trim() };
  };

  for (const l of linhas) {
    const numero = s(l["Nº NOTA"]);
    const nup = s(l["NUP"]);
    if (!numero && !nup) { r.ignoradas++; continue; }
    const rotulo = `NF ${numero || nup}`;
    try {
      const chave = soDigitos(nup).length === 44 && /^\d+$/.test(nup) ? nup : nup || null;
      const cnpj = soDigitos(s(l["CNPJ"])) || "0";
      const nome = s(l["NOME EMPRESA"]) || "(sem nome)";
      const valor = lerValor(l["VALOR DA NOTA"]);
      const oc = s(l["OC"]) && s(l["OC"]) !== "0" ? s(l["OC"]) : null;

      const [dup] = await sql`select id from notas where origem = 'importacao' and numero = ${numero || nup} and emit_cnpj = ${cnpj}
                               and valor = ${valor} and coalesce(chave, '') = ${chave ?? ""} limit 1`;
      if (dup) { r.ignoradas++; continue; }

      const eventos: Ev[] = [];
      let seq = 0;
      const mov = (quando: Date, de: string | null, para: string, etapaAnt: number | null, usuario: string | null, texto: string | null = null) => {
        const d = destino(para, etapaAnt);
        const origem = de ? porNome.get(semAcento(de)) : undefined;
        const alvo = d.etapa_id ? etapas.find((e) => e.id === d.etapa_id) : undefined;
        const tipo =
          eventos.length === 0 ? "cadastro"
          : d.status !== "em_tramite" ? TIPO_POR_STATUS[d.status]
          : semAcento(de ?? "") === "reprovada" || (origem && alvo && alvo.ordem < origem.ordem) ? "retorno" : "avanco";
        eventos.push({
          tipo, movimento: true, de_nome: eventos.length === 0 ? "Cadastro" : de, para_etapa_id: d.etapa_id, para_status: d.status, para_nome: d.nome,
          usuario_nome: usuario, texto, criado_em: new Date(quando.getTime() + seq++ * 1000),
        });
        return d;
      };

      const historico = s(l["Histórico de Trâmite"]).split("\n").map((x) =>
        x.trim().match(/^\d+\s*-\s*(.+?)\s*\((\S+)\s*\/\/\s*(.+?)\)\s*\(\s*(\d{2}\/\d{2}\/\d{4} \d{1,2}:\d{2})\s*\)\s*:\s*(.+)$/)).filter(Boolean) as RegExpMatchArray[];
      const dataSecom = lerData(l["SECOM"]);
      const primeira = historico[0] ? lerData(historico[0][4]) : null;
      const recebida = dataSecom && (!primeira || dataSecom <= primeira) ? dataSecom : (primeira ?? dataSecom ?? new Date());
      let atual: { status: string; etapa_id: number | null; nome: string } = { status: "em_tramite", etapa_id: etapas[0]?.id ?? null, nome: etapas[0]?.nome ?? "" };
      let ultimaEtapa: number | null = null;
      const extras: Ev[] = [];

      if (historico.length) {
        for (const h of historico) {
          const quando = lerData(h[4])!;
          const msg = h[5].trim();
          const partes = msg.match(/^(.+?)\s+para\s+(.+)$/);
          if (!partes) {
            const tipo = /arrecadad/i.test(msg) ? "arrecadacao" : /armazenad/i.test(msg) ? "armazenagem" : "observacao";
            extras.push({ tipo, movimento: false, de_nome: null, para_etapa_id: null, para_status: null, para_nome: null, usuario_nome: h[1], texto: tipo === "observacao" ? msg : null, criado_em: quando });
            continue;
          }
          if (eventos.length === 0 && semAcento(partes[1]) !== "secom") {
            // histórico incompleto: registra a entrada na situação em que a NF estava
            atual = mov(recebida, null, partes[1], etapaReprova?.id ?? null, null, "Histórico anterior a esta data não disponível (importado da planilha).");
            if (atual.etapa_id) ultimaEtapa = atual.etapa_id;
          }
          atual = mov(eventos.length === 0 ? recebida : quando, partes[1], partes[2], ultimaEtapa, h[1]);
          if (atual.etapa_id) ultimaEtapa = atual.etapa_id;
        }
      } else {
        // sem histórico: reconstrói pelas colunas de data de cada setor
        atual = mov(recebida, null, etapas[0]?.nome ?? "Pré Recebimento", null, null);
        ultimaEtapa = atual.etapa_id;
        let ultimo = recebida;
        const situacaoFinal = STATUS_POR_NOME[semAcento(s(l["Situação Atual"]))];
        for (let i = 0; i < etapas.length; i++) {
          const dt = lerData(l[etapas[i].nome]);
          if (!dt) break;
          ultimo = dt > ultimo ? dt : ultimo;
          const reprovaAqui = (situacaoFinal === "reprovada" || situacaoFinal === "retirada") && etapas[i].permite_reprovar;
          const para = reprovaAqui ? "Reprovada" : (etapas[i + 1]?.nome ?? "Finalizada");
          atual = mov(ultimo, etapas[i].nome, para, etapas[i].id, null);
          if (atual.etapa_id) ultimaEtapa = atual.etapa_id;
          if (reprovaAqui) break;
        }
      }

      // a situação da planilha é a que vale
      const alvo = destino(s(l["Situação Atual"]) || atual.nome, ultimaEtapa);
      if (alvo.status === "em_tramite" && !alvo.etapa_id) { alvo.etapa_id = etapas[0]?.id ?? null; alvo.nome = etapas[0]?.nome ?? alvo.nome; }
      if (alvo.status !== atual.status || (alvo.status === "em_tramite" && alvo.etapa_id !== atual.etapa_id)) {
        const ult = eventos[eventos.length - 1].criado_em;
        const dataCol = lerData(l["Controle"]) ?? lerData(l["Contagem"]) ?? lerData(l["Perícia"]);
        const quando = dataCol && dataCol > ult ? dataCol : new Date(ult.getTime() + 1000);
        const de = atual.nome;
        atual = mov(quando, de, alvo.nome, ultimaEtapa, null, "Situação ajustada conforme a planilha (importação).");
        eventos[eventos.length - 1].tipo = alvo.status === "em_tramite" ? "ajuste" : TIPO_POR_STATUS[alvo.status];
      }

      // observações da NF: "1 - Perfil ( dd/mm/aaaa ) : texto"
      const obsTexto = s(l["Observações da NF"]);
      const marcas = [...obsTexto.matchAll(/(?:^|\n)\d+\s*-\s*([^\n(]+?)\s*\(\s*(\d{2}\/\d{2}\/\d{4})\s*\)\s*:\s*/g)];
      const vistos = new Set<string>();
      marcas.forEach((m, i) => {
        const texto = obsTexto.slice(m.index! + m[0].length, marcas[i + 1]?.index ?? obsTexto.length).trim();
        const k = `${m[1]}|${m[2]}|${texto}`;
        if (!texto || vistos.has(k)) return;
        vistos.add(k);
        extras.push({ tipo: "observacao", movimento: false, de_nome: null, para_etapa_id: null, para_status: null, para_nome: null, usuario_nome: m[1].trim(), texto, criado_em: new Date(lerData(m[2], "18:00")!.getTime() + i * 1000) });
      });
      if (obsTexto && !marcas.length)
        extras.push({ tipo: "observacao", movimento: false, de_nome: null, para_etapa_id: null, para_status: null, para_nome: null, usuario_nome: null, texto: obsTexto, criado_em: new Date(recebida.getTime() + 60000) });

      const ultimoMov = eventos[eventos.length - 1].criado_em;
      const concluida = atual.status === "em_tramite" || atual.status === "reprovada" ? null : ultimoMov;
      const obsOc = s(l["Observações da OC"]).replace(/^-+/, "").trim() || null;
      const flag = (v: Celula | undefined) => (["", "false", "falso"].includes(s(v).toLowerCase()) ? null : s(v));
      const nota = { numero: numero || nup, chave, emit_nome: nome, emit_cnpj: cnpj, oc };

      await sql.begin(async (tx) => {
        await tx`insert into empresas (cnpj, nome) values (${cnpj}, ${nome}) on conflict (cnpj) do nothing`;
        const [n] = await tx`insert into notas (chave, numero, emit_cnpj, emit_nome, valor, oc, sob_medida, status, etapa_id, etapa_desde, recebida_em,
              concluida_em, arrecadada_em, armazenada_em, reprov_visual, reprov_laboratorial, obs_oc, busca, origem)
            values (${chave}, ${nota.numero}, ${cnpj}, ${nome}, ${valor}, ${oc}, ${semAcento(s(l["Sob Medida"])) === "sim"}, ${atual.status}, ${atual.etapa_id},
              ${ultimoMov}, ${recebida}, ${concluida}, ${lerData(l["Arrecadação"])}, ${lerData(l["Armazenado"])},
              ${atual.status === "reprovada" ? flag(l["PERÍCIA VISUAL"]) : null}, ${atual.status === "reprovada" ? flag(l["PERÍCIA LABORATORIAL"]) : null},
              ${obsOc}, ${textoBusca(nota)}, 'importacao')
            returning id`;
        const todos = [...eventos, ...extras].map((e) => ({ ...e, nota_id: n.id as number }));
        await tx`insert into eventos ${tx(todos, "nota_id", "tipo", "movimento", "de_nome", "para_etapa_id", "para_status", "para_nome", "usuario_nome", "texto", "criado_em")}`;
      });
      r.importadas++;
    } catch (e) {
      r.erros.push(`${rotulo}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return r;
}
