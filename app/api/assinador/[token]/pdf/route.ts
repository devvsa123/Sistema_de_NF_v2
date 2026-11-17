import { pdfParaAssinar } from "@/lib/assinador";

/** Usado pelo Assistente de Assinatura (sem login: o código de uso único autoriza). */
export async function GET(_: Request, ctx: RouteContext<"/api/assinador/[token]/pdf">) {
  try {
    const d = await pdfParaAssinar((await ctx.params).token);
    return new Response(Buffer.from(d.bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${d.nome}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    return Response.json({ ok: false, mensagem: e instanceof Error ? e.message : "Erro." }, { status: 400 });
  }
}
