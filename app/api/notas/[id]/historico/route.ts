import { ehInterno, usuarioAtual } from "@/lib/auth";
import { historicoDaNota } from "@/lib/pacote";

/** Histórico da NF em PDF (vai no pacote final da NF). */
export async function GET(_: Request, ctx: RouteContext<"/api/notas/[id]/historico">) {
  const u = await usuarioAtual();
  if (!u || u.deve_trocar_senha || !ehInterno(u)) return new Response("Não autorizado", { status: 401 });
  try {
    const r = await historicoDaNota(u, Number((await ctx.params).id) || 0);
    return new Response(Buffer.from(r.bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(r.nome)}`, "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Erro ao gerar o histórico.", { status: 500 });
  }
}
