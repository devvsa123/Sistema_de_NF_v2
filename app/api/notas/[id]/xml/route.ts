import { usuarioAtual } from "@/lib/auth";
import { xmlDaNota } from "@/lib/notas";

export async function GET(_: Request, ctx: RouteContext<"/api/notas/[id]/xml">) {
  const u = await usuarioAtual();
  if (!u || u.deve_trocar_senha) return new Response("Não autorizado", { status: 401 });
  const r = await xmlDaNota(u, Number((await ctx.params).id));
  if (!r) return new Response("Não encontrado", { status: 404 });
  const nome = (r.chave && /^\d{44}$/.test(r.chave) ? r.chave : `NF-${r.numero.replace(/\W/g, "")}`) + ".xml";
  return new Response(r.xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="${nome}"`, "Cache-Control": "private, no-store" },
  });
}
