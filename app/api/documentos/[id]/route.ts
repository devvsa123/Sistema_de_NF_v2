import { ehInterno, usuarioAtual } from "@/lib/auth";
import { arquivoDoDocumento } from "@/lib/documentos";

export async function GET(req: Request, ctx: RouteContext<"/api/documentos/[id]">) {
  const u = await usuarioAtual();
  if (!u || u.deve_trocar_senha || !ehInterno(u)) return new Response("Não autorizado", { status: 401 });
  try {
    const a = await arquivoDoDocumento(Number((await ctx.params).id) || 0);
    if (!a) return new Response("Não encontrado", { status: 404 });
    const baixar = new URL(req.url).searchParams.has("baixar");
    return new Response(Buffer.from(a.bytes), {
      headers: {
        "Content-Type": a.mime,
        "Content-Disposition": `${baixar ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(a.nome)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Erro ao ler o arquivo.", { status: 502 });
  }
}
