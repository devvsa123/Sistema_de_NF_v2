// Aplica as migrações pendentes de db/migrations no banco apontado por DATABASE_URL.
// Roda automaticamente antes do build (veja "build" no package.json).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.warn("[migrate] DATABASE_URL não definida — migrações ignoradas.");
  process.exit(0);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  await sql`create table if not exists _migracoes (nome text primary key, aplicada_em timestamptz not null default now())`;
  const feitas = new Set((await sql`select nome from _migracoes`).map((r) => r.nome));
  for (const arquivo of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (feitas.has(arquivo)) continue;
    console.log(`[migrate] aplicando ${arquivo}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(join(dir, arquivo), "utf8"));
      await tx`insert into _migracoes (nome) values (${arquivo})`;
    });
  }
  console.log("[migrate] banco atualizado.");
} finally {
  await sql.end();
}
