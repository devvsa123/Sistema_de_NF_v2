import { ehInterno, usuarioAtual } from "@/lib/auth";
import { documentoRecebimento } from "@/lib/recebimento";

export async function GET(req: Request, ctx: RouteContext<"/api/recebimento/[id]">) {
  const u = await usuarioAtual();
  if (!u || u.deve_trocar_senha || !ehInterno(u)) return new Response("Não autorizado", { status: 401 });
  const doc = new URL(req.url).searchParams.get("doc") === "checklist" ? "checklist" : "tav";
  const r = await documentoRecebimento(Number((await ctx.params).id) || 0, doc, u);
  if (!r) return new Response("Não encontrado", { status: 404 });
  return new Response(Buffer.from(r.bytes), {
    headers: { "Content-Type": r.mime, "Content-Disposition": `attachment; filename="${r.nome}"`, "Cache-Control": "private, no-store" },
  });
}
