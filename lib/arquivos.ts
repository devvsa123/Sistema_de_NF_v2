import "server-only";
import { AwsClient } from "aws4fetch";

/**
 * Armazenamento dos arquivos: Cloudflare R2 quando configurado (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET); senão, no próprio banco de dados.
 */

function r2() {
  const { R2_ACCOUNT_ID: conta, R2_ACCESS_KEY_ID: id, R2_SECRET_ACCESS_KEY: segredo, R2_BUCKET: balde } = process.env;
  if (!conta || !id || !segredo || !balde) return null;
  return { cliente: new AwsClient({ accessKeyId: id, secretAccessKey: segredo, service: "s3", region: "auto" }), base: `https://${conta}.r2.cloudflarestorage.com/${balde}` };
}

export const armazenamentoExterno = () => !!r2();

const caminho = (chave: string) => chave.split("/").map(encodeURIComponent).join("/");

/** Guarda o arquivo. Devolve onde ficou. */
export async function guardar(chave: string, bytes: Uint8Array, mime: string): Promise<{ armazenamento: "r2" | "banco"; chave: string | null }> {
  const r = r2();
  if (!r) return { armazenamento: "banco", chave: null };
  const resp = await r.cliente.fetch(`${r.base}/${caminho(chave)}`, { method: "PUT", body: Buffer.from(bytes), headers: { "content-type": mime } });
  if (!resp.ok) throw new Error(`Não foi possível guardar o arquivo no armazenamento (${resp.status}).`);
  return { armazenamento: "r2", chave };
}

export async function ler(chave: string): Promise<Uint8Array> {
  const r = r2();
  if (!r) throw new Error("O armazenamento de arquivos (R2) não está configurado.");
  const resp = await r.cliente.fetch(`${r.base}/${caminho(chave)}`);
  if (!resp.ok) throw new Error(`Arquivo não encontrado no armazenamento (${resp.status}).`);
  return new Uint8Array(await resp.arrayBuffer());
}

/** Teste de conexão para a página de administração. */
export async function testarArmazenamento(): Promise<string> {
  const r = r2();
  if (!r) return "R2 não configurado: os arquivos ficam no banco de dados.";
  const chave = `_teste/${Date.now()}.txt`;
  await guardar(chave, new TextEncoder().encode("ok"), "text/plain");
  const lido = new TextDecoder().decode(await ler(chave));
  await r.cliente.fetch(`${r.base}/${caminho(chave)}`, { method: "DELETE" });
  if (lido !== "ok") throw new Error("O arquivo de teste voltou diferente.");
  return "Conexão com o Cloudflare R2 funcionando.";
}
