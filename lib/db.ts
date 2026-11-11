import "server-only";
import postgres from "postgres";

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;

const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };

function criar() {
  if (!url) throw new Error("DATABASE_URL não configurada.");
  return postgres(url, {
    max: 5,
    idle_timeout: 20,
    prepare: false, // compatível com conexões "pooled" (Neon / Supabase)
    onnotice: () => {},
  });
}

// Conexão única reaproveitada entre requisições
export const sql: ReturnType<typeof postgres> = new Proxy(function () {} as never, {
  get(_t, prop) {
    globalForDb.sql ??= criar();
    return (globalForDb.sql as never)[prop];
  },
  apply(_t, _this, args) {
    globalForDb.sql ??= criar();
    return (globalForDb.sql as unknown as (...a: unknown[]) => unknown)(...args);
  },
});

export type Tx = postgres.TransactionSql;
