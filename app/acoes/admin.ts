"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { exigirAdmin, exigirGestorUsuarios, hashSenha, validarSenhaNova } from "@/lib/auth";
import { soDigitos } from "@/lib/format";
import { importarNotas, importarUsuarios, type Linha } from "@/lib/importar";
import type { Estado } from "@/components/FormAcao";

const campo = (f: FormData, nome: string) => String(f.get(nome) ?? "").trim();
const marcado = (f: FormData, nome: string) => f.get(nome) === "on";
const msg = (e: unknown) => {
  const m = e instanceof Error ? e.message : "Erro inesperado.";
  if (m.includes("etapas_nome_ativo")) return "Já existe uma etapa com esse nome.";
  if (m.includes("usuarios_login_key")) return "Já existe um usuário com esse login.";
  return m;
};

async function renumerar(tx: typeof sql) {
  await tx`update etapas e set ordem = x.n from (select id, row_number() over (order by ordem, id) as n from etapas where ativo) x where x.id = e.id`;
}

// ---------- Caminho de tramitação ----------

export async function acaoSalvarEtapa(_: Estado, f: FormData): Promise<Estado> {
  await exigirAdmin();
  const id = Number(f.get("id")) || null;
  const nome = campo(f, "nome").slice(0, 60);
  const prazo = Math.max(1, Math.min(365, Number(f.get("prazo_dias")) || 0));
  if (!nome) return { erro: "Informe o nome da etapa." };
  if (["finalizada", "reprovada", "arquivada", "cadastro"].includes(nome.toLowerCase())) return { erro: "Esse nome é reservado pelo sistema." };
  try {
    await sql.begin(async (tx) => {
      if (marcado(f, "entrada_sob_medida")) await tx`update etapas set entrada_sob_medida = false`;
      if (id) {
        await tx`update etapas set nome = ${nome}, prazo_dias = ${prazo}, permite_reprovar = ${marcado(f, "permite_reprovar")}, emite_laudo = ${marcado(f, "emite_laudo")},
                   exige_arrecadacao = ${marcado(f, "exige_arrecadacao")}, faz_armazenagem = ${marcado(f, "faz_armazenagem")},
                   entrada_sob_medida = ${marcado(f, "entrada_sob_medida")} where id = ${id} and ativo`;
      } else {
        await tx`insert into etapas (nome, prazo_dias, ordem) values (${nome}, ${prazo}, (select coalesce(max(ordem), 0) + 1 from etapas where ativo))`;
      }
    });
  } catch (e) {
    return { erro: msg(e) };
  }
  revalidatePath("/", "layout");
  return { ok: id ? "Etapa salva." : "Etapa adicionada ao final do caminho." };
}

export async function acaoMoverEtapa(id: number, direcao: number) {
  await exigirAdmin();
  await sql.begin(async (tx) => {
    await renumerar(tx as never);
    const [e] = await tx`select id, ordem from etapas where id = ${id} and ativo`;
    if (!e) return;
    const [viz] = await tx`select id, ordem from etapas where ativo and ordem = ${e.ordem + (direcao < 0 ? -1 : 1)}`;
    if (!viz) return;
    await tx`update etapas set ordem = ${viz.ordem} where id = ${e.id}`;
    await tx`update etapas set ordem = ${e.ordem} where id = ${viz.id}`;
  });
  revalidatePath("/", "layout");
}

export async function acaoRemoverEtapa(_: Estado, f: FormData): Promise<Estado> {
  await exigirAdmin();
  const id = Number(f.get("id"));
  const [r] = await sql`select (select count(*)::int from notas where etapa_id = ${id} and status in ('em_tramite','reprovada')) as abertas,
                               (select count(*)::int from etapas where ativo) as total`;
  if (r.abertas > 0) return { erro: `Há ${r.abertas} NF nesta etapa. Tramite-as para outra etapa antes de remover.` };
  if (r.total <= 1) return { erro: "O caminho precisa ter pelo menos uma etapa." };
  await sql.begin(async (tx) => {
    // a etapa é apenas desativada, para preservar o histórico das NF que passaram por ela
    await tx`update etapas set ativo = false, entrada_sob_medida = false where id = ${id}`;
    await tx`delete from usuario_etapas where etapa_id = ${id}`;
    await renumerar(tx as never);
  });
  revalidatePath("/", "layout");
  return { ok: "Etapa removida do caminho." };
}

export async function acaoPrazoReprovada(_: Estado, f: FormData): Promise<Estado> {
  await exigirAdmin();
  const prazo = Math.max(1, Math.min(365, Number(f.get("prazo")) || 10));
  await sql`insert into config (chave, valor) values ('prazo_reprovada', ${String(prazo)}) on conflict (chave) do update set valor = excluded.valor`;
  revalidatePath("/", "layout");
  return { ok: "Prazo salvo." };
}

// ---------- Usuários ----------

export async function acaoSalvarUsuario(_: Estado, f: FormData): Promise<Estado> {
  const quem = await exigirGestorUsuarios();
  const geral = quem.papel === "admin";
  const id = Number(f.get("id")) || null;
  const login = soDigitos(campo(f, "login"));
  const nome = campo(f, "nome").slice(0, 120);
  const papel = campo(f, "papel");
  const senha = String(f.get("senha") ?? "");
  const ativo = id ? marcado(f, "ativo") : true;
  if (!login || !nome) return { erro: "Informe nome e login (NIP ou CNPJ, somente números)." };
  if (!["admin", "interno", "consulta", "empresa"].includes(papel)) return { erro: "Perfil inválido." };

  const [alvo] = id ? await sql`select papel, gerencia_usuarios, ativo from usuarios where id = ${id}` : [];
  if (id && !alvo) return { erro: "Usuário não encontrado." };
  if (!geral) {
    // o administrador de usuários não mexe em administradores nem cria novos
    if (papel === "admin") return { erro: "Somente o administrador geral pode criar outro administrador geral." };
    if (alvo && (alvo.papel === "admin" || alvo.gerencia_usuarios)) return { erro: "Somente o administrador geral altera os administradores." };
  }
  if (id === quem.id && (papel !== quem.papel || !ativo)) return { erro: "Você não pode alterar o seu próprio perfil ou desativar o seu acesso." };
  if (alvo?.papel === "admin" && (papel !== "admin" || !ativo)) {
    const [r] = await sql`select count(*)::int as n from usuarios where papel = 'admin' and ativo and id <> ${id}`;
    if (r.n === 0) return { erro: "O sistema precisa ter pelo menos um administrador geral ativo." };
  }
  if (!id && !senha) return { erro: "Defina uma senha inicial." };
  if (senha) {
    const erro = validarSenhaNova(senha, senha);
    if (erro) return { erro };
  }
  const cnpjEmpresa = papel === "empresa" ? soDigitos(campo(f, "empresa_cnpj")) || login : null;
  if (papel === "empresa" && cnpjEmpresa!.length !== 14) return { erro: "Para fornecedores, informe o CNPJ com 14 dígitos." };
  const etapas = papel === "interno" ? f.getAll("etapas").map(Number).filter(Boolean) : [];
  const hash = senha ? await hashSenha(senha) : null;
  const gerencia = (papel === "interno" || papel === "consulta") && (geral ? marcado(f, "gerencia_usuarios") : !!alvo?.gerencia_usuarios);
  try {
    await sql.begin(async (tx) => {
      if (cnpjEmpresa) await tx`insert into empresas (cnpj, nome) values (${cnpjEmpresa}, ${nome}) on conflict (cnpj) do nothing`;
      const dados = {
        login, nome, papel, empresa_cnpj: cnpjEmpresa, ativo, gerencia_usuarios: gerencia,
        pode_cadastrar: papel === "interno" && marcado(f, "pode_cadastrar"),
        trata_reprovadas: papel === "interno" && marcado(f, "trata_reprovadas"),
      };
      let uid = id;
      if (id) {
        await tx`update usuarios set ${tx(dados)} where id = ${id}`;
        if (hash) {
          await tx`update usuarios set senha_hash = ${hash}, senha_legado_sha256 = null, deve_trocar_senha = ${marcado(f, "deve_trocar")}, falhas_login = 0, bloqueado_ate = null where id = ${id}`;
          await tx`delete from sessoes where usuario_id = ${id} and usuario_id <> ${quem.id}`;
        }
        if (!ativo) await tx`delete from sessoes where usuario_id = ${id}`;
      } else {
        const [u] = await tx`insert into usuarios ${tx({ ...dados, senha_hash: hash, deve_trocar_senha: marcado(f, "deve_trocar") })} returning id`;
        uid = u.id;
      }
      await tx`delete from usuario_etapas where usuario_id = ${uid}`;
      for (const e of etapas) await tx`insert into usuario_etapas (usuario_id, etapa_id) select ${uid}, id from etapas where id = ${e} and ativo`;
    });
  } catch (e) {
    return { erro: msg(e) };
  }
  revalidatePath("/admin/usuarios");
  redirect("/admin/usuarios");
}

// ---------- Importação da planilha antiga ----------

function validarLote(linhas: unknown): linhas is Linha[] {
  return Array.isArray(linhas) && linhas.length <= 200 && linhas.every((l) => l && typeof l === "object");
}

export async function acaoImportarUsuarios(linhas: Linha[]) {
  await exigirAdmin();
  if (!validarLote(linhas)) return { importadas: 0, ignoradas: 0, erros: ["Lote inválido."] };
  return importarUsuarios(linhas);
}

export async function acaoImportarNotas(linhas: Linha[]) {
  await exigirAdmin();
  if (!validarLote(linhas)) return { importadas: 0, ignoradas: 0, erros: ["Lote inválido."] };
  const r = await importarNotas(linhas);
  revalidatePath("/", "layout");
  return r;
}
