import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { sql } from "./db";
import { soDigitos } from "./format";

const COOKIE = "nf_sessao";
const HORAS_SESSAO = 12;
const MAX_FALHAS = 5;
const MINUTOS_BLOQUEIO = 15;

export type Papel = "admin" | "interno" | "consulta" | "empresa";

export type Usuario = {
  id: number;
  login: string;
  nome: string;
  papel: Papel;
  empresa_cnpj: string | null;
  pode_cadastrar: boolean;
  trata_reprovadas: boolean;
  deve_trocar_senha: boolean;
  etapas: number[]; // etapas em que o usuário pode tramitar
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const hashSenha = (senha: string) => bcrypt.hash(senha, 10);

export function validarSenhaNova(senha: string, confirmar: string): string | null {
  if (senha.length < 8) return "A senha deve ter pelo menos 8 caracteres.";
  if (senha !== confirmar) return "As senhas não coincidem.";
  return null;
}

/** Usuário da requisição atual (ou null). Uma única consulta por requisição. */
export const usuarioAtual = cache(async (): Promise<Usuario | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [u] = await sql<Usuario[]>`
    select u.id, u.login, u.nome, u.papel, u.empresa_cnpj, u.pode_cadastrar, u.trata_reprovadas, u.deve_trocar_senha,
           coalesce((select array_agg(ue.etapa_id) from usuario_etapas ue where ue.usuario_id = u.id), '{}') as etapas
    from sessoes s join usuarios u on u.id = s.usuario_id
    where s.token_hash = ${sha256(token)} and s.expira_em > now() and u.ativo`;
  return u ?? null;
});

/** Exige login; redireciona para /login (ou troca de senha obrigatória). */
export async function exigirUsuario(opcoes: { permitirTrocaPendente?: boolean } = {}): Promise<Usuario> {
  const u = await usuarioAtual();
  if (!u) redirect("/login");
  if (u.deve_trocar_senha && !opcoes.permitirTrocaPendente) redirect("/trocar-senha");
  return u;
}

export async function exigirAdmin(): Promise<Usuario> {
  const u = await exigirUsuario();
  if (u.papel !== "admin") redirect("/");
  return u;
}

/** Perfis que enxergam todas as NF (empresas só enxergam as próprias). */
export const ehInterno = (u: Usuario) => u.papel === "admin" || u.papel === "interno" || u.papel === "consulta";
export const podeCadastrar = (u: Usuario) => u.papel === "admin" || (u.papel === "interno" && u.pode_cadastrar);

async function abrirSessao(usuarioId: number) {
  const token = randomBytes(32).toString("base64url");
  await sql`insert into sessoes (token_hash, usuario_id, expira_em)
            values (${sha256(token)}, ${usuarioId}, now() + make_interval(hours => ${HORAS_SESSAO}))`;
  await sql`delete from sessoes where expira_em < now()`;
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: HORAS_SESSAO * 3600,
  });
}

async function conferirSenha(u: { senha_hash: string | null; senha_legado_sha256: string | null }, senha: string) {
  if (u.senha_hash) return bcrypt.compare(senha, u.senha_hash);
  if (u.senha_legado_sha256) {
    const a = Buffer.from(sha256(senha));
    const b = Buffer.from(u.senha_legado_sha256.trim().toLowerCase());
    return a.length === b.length && timingSafeEqual(a, b);
  }
  return false;
}

export async function entrar(loginInformado: string, senha: string): Promise<string | null> {
  const login = soDigitos(loginInformado);
  const invalido = "Usuário ou senha inválidos.";
  if (!login || !senha) return invalido;
  const [u] = await sql`select id, senha_hash, senha_legado_sha256, ativo, bloqueado_ate from usuarios where login = ${login}`;
  if (!u) {
    await bcrypt.compare(senha, "$2b$10$CwTycUXWue0Thq9StjUM0uJ8rQ8uQhQ0yQJ9o0V8t1vO1yQkz3k6e"); // tempo de resposta uniforme
    return invalido;
  }
  if (u.bloqueado_ate && new Date(u.bloqueado_ate) > new Date())
    return `Muitas tentativas. Aguarde ${MINUTOS_BLOQUEIO} minutos e tente novamente.`;
  if (!u.ativo || !(await conferirSenha(u as never, senha))) {
    await sql`update usuarios set falhas_login = falhas_login + 1,
                bloqueado_ate = case when falhas_login + 1 >= ${MAX_FALHAS} then now() + make_interval(mins => ${MINUTOS_BLOQUEIO}) else bloqueado_ate end
              where id = ${u.id}`;
    return invalido;
  }
  // Senha vinda do sistema antigo (SHA-256): regrava em formato seguro no primeiro acesso
  if (!u.senha_hash) {
    await sql`update usuarios set senha_hash = ${await hashSenha(senha)}, senha_legado_sha256 = null where id = ${u.id}`;
  }
  await sql`update usuarios set falhas_login = 0, bloqueado_ate = null where id = ${u.id}`;
  await abrirSessao(u.id);
  return null;
}

export async function sair() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await sql`delete from sessoes where token_hash = ${sha256(token)}`;
  jar.delete(COOKIE);
}

export async function trocarSenha(u: Usuario, atual: string, nova: string, confirmar: string): Promise<string | null> {
  const erro = validarSenhaNova(nova, confirmar);
  if (erro) return erro;
  const [reg] = await sql`select senha_hash, senha_legado_sha256 from usuarios where id = ${u.id}`;
  if (!(await conferirSenha(reg as never, atual))) return "Senha atual incorreta.";
  if (atual === nova) return "A nova senha deve ser diferente da atual.";
  await sql`update usuarios set senha_hash = ${await hashSenha(nova)}, senha_legado_sha256 = null, deve_trocar_senha = false where id = ${u.id}`;
  // encerra as outras sessões do usuário
  const token = (await cookies()).get(COOKIE)?.value;
  await sql`delete from sessoes where usuario_id = ${u.id} and token_hash <> ${token ? sha256(token) : ""}`;
  return null;
}

export async function existeAlgumUsuario() {
  const [r] = await sql`select exists(select 1 from usuarios) as tem`;
  return r.tem as boolean;
}
