import "server-only";
import https from "node:https";
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
  const corpo = Buffer.from(bytes);
  // assina a requisição (S3/R2) e envia pela conexão HTTPS do Node com o tamanho explícito:
  // o fetch do Next.js pode mandar o corpo em pedaços (sem Content-Length) e o R2 recusa com 411
  const assinado = await r.cliente.sign(`${r.base}/${caminho(chave)}`, { method: "PUT", body: corpo, headers: { "content-type": mime } });
  const status = await enviarPut(assinado.url, Object.fromEntries(assinado.headers.entries()), corpo);
  if (status < 200 || status >= 300) throw new Error(`Não foi possível guardar o arquivo no armazenamento (${status}).`);
  return { armazenamento: "r2", chave };
}

function enviarPut(url: string, cabecalhos: Record<string, string>, corpo: Buffer): Promise<number> {
  return new Promise((ok, falha) => {
    const req = https.request(url, { method: "PUT", headers: { ...cabecalhos, "content-length": String(corpo.length) }, timeout: 60000 }, (res) => {
      res.resume();
      res.on("end", () => ok(res.statusCode ?? 0));
    });
    req.on("timeout", () => req.destroy(new Error("Tempo esgotado ao guardar o arquivo.")));
    req.on("error", falha);
    req.end(corpo);
  });
}

export async function ler(chave: string): Promise<Uint8Array> {
  const r = r2();
  if (!r) throw new Error("O armazenamento de arquivos (R2) não está configurado.");
  const resp = await r.cliente.fetch(`${r.base}/${caminho(chave)}`);
  if (!resp.ok) throw new Error(`Arquivo não encontrado no armazenamento (${resp.status}).`);
  return new Uint8Array(await resp.arrayBuffer());
}

/** Lê o arquivo do R2 como fluxo (para downloads grandes, sem passar do limite de resposta da Vercel). */
export async function lerFluxo(chave: string): Promise<ReadableStream<Uint8Array>> {
  const r = r2();
  if (!r) throw new Error("O armazenamento de arquivos (R2) não está configurado.");
  const resp = await r.cliente.fetch(`${r.base}/${caminho(chave)}`);
  if (!resp.ok || !resp.body) throw new Error(`Arquivo não encontrado no armazenamento (${resp.status}).`);
  return resp.body;
}

/** Exclui o arquivo do armazenamento (R2). */
export async function apagar(chave: string): Promise<void> {
  const r = r2();
  if (!r) return;
  const resp = await r.cliente.fetch(`${r.base}/${caminho(chave)}`, { method: "DELETE" });
  if (!resp.ok && resp.status !== 404) throw new Error(`Não foi possível excluir o arquivo do armazenamento (${resp.status}).`);
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
