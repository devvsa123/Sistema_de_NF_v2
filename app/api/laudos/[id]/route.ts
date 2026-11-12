import { ehInterno, usuarioAtual } from "@/lib/auth";
import { documentoDoLaudo } from "@/lib/laudo";

export async function GET(_: Request, ctx: RouteContext<"/api/laudos/[id]">) {
  const u = await usuarioAtual();
  if (!u || u.deve_trocar_senha || !ehInterno(u)) return new Response("Não autorizado", { status: 401 });
  const doc = await documentoDoLaudo(Number((await ctx.params).id) || 0);
  if (!doc) return new Response("Não encontrado", { status: 404 });
  return new Response(Buffer.from(doc.bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${doc.nome}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
