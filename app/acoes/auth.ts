"use server";

import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { entrar, exigirUsuario, existeAlgumUsuario, hashSenha, sair, trocarSenha, validarSenhaNova } from "@/lib/auth";
import { soDigitos } from "@/lib/format";
import type { Estado } from "@/components/FormAcao";

const campo = (f: FormData, nome: string) => String(f.get(nome) ?? "");

export async function acaoEntrar(_: Estado, f: FormData): Promise<Estado> {
  const erro = await entrar(campo(f, "login"), campo(f, "senha"));
  if (erro) return { erro };
  redirect("/");
}

export async function acaoSair() {
  await sair();
  redirect("/login");
}

export async function acaoTrocarSenha(_: Estado, f: FormData): Promise<Estado> {
  const u = await exigirUsuario({ permitirTrocaPendente: true });
  const erro = await trocarSenha(u, campo(f, "atual"), campo(f, "nova"), campo(f, "confirmar"));
  if (erro) return { erro };
  redirect("/");
}

/** Primeiro acesso: cria o administrador. Só funciona enquanto não existir nenhum usuário. */
export async function acaoSetup(_: Estado, f: FormData): Promise<Estado> {
  const login = soDigitos(campo(f, "login"));
  const nome = campo(f, "nome").trim();
  const senha = campo(f, "senha");
  if (!login || !nome) return { erro: "Informe nome e usuário (NIP, somente números)." };
  const erro = validarSenhaNova(senha, campo(f, "confirmar"));
  if (erro) return { erro };
  const hash = await hashSenha(senha);
  const criado = await sql.begin(async (tx) => {
    await tx`lock table usuarios in exclusive mode`;
    const [r] = await tx`select exists(select 1 from usuarios) as tem`;
    if (r.tem) return false;
    await tx`insert into usuarios (login, nome, senha_hash, papel) values (${login}, ${nome}, ${hash}, 'admin')`;
    return true;
  });
  if (!criado || !(await existeAlgumUsuario())) return { erro: "O sistema já foi configurado. Use a tela de login." };
  const e = await entrar(login, senha);
  if (e) return { erro: e };
  redirect("/admin/importar");
}
