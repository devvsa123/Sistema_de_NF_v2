import { revalidatePath } from "next/cache";
import { receberAssinado } from "@/lib/assinador";

/** O Assistente devolve aqui o PDF assinado no Adobe. */
export async function POST(req: Request, ctx: RouteContext<"/api/assinador/[token]/enviar">) {
  try {
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length) throw new Error("Arquivo vazio.");
    const nome = decodeURIComponent(req.headers.get("x-nome-arquivo") ?? "documento-assinado.pdf").replace(/[\\/]/g, "_").slice(-120);
    const mensagem = await receberAssinado((await ctx.params).token, bytes, nome);
    revalidatePath("/", "layout");
    return Response.json({ ok: true, mensagem });
  } catch (e) {
    return Response.json({ ok: false, mensagem: e instanceof Error ? e.message : "Erro." }, { status: 400 });
  }
}
