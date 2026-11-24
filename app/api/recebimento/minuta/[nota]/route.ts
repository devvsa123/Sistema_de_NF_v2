import { usuarioAtual } from "@/lib/auth";
import { etapasAtivas } from "@/lib/fluxo";
import { obterNota } from "@/lib/notas";
import { minutaTav, podeMinutaTav } from "@/lib/recebimento";

/** Minuta do TAV para imprimir e conferir no recebimento (somente Pré Recebimento). Não registra nada. */
export async function GET(_: Request, ctx: RouteContext<"/api/recebimento/minuta/[nota]">) {
  const u = await usuarioAtual();
  if (!u || u.deve_trocar_senha) return new Response("Não autorizado", { status: 401 });
  const id = Number((await ctx.params).nota) || 0;
  const nota = await obterNota(u, id);
  if (!nota) return new Response("Não encontrado", { status: 404 });
  if (!podeMinutaTav(u, await etapasAtivas(), nota)) return new Response("A minuta do TAV é só para o Pré Recebimento, com a NF nessa etapa.", { status: 403 });
  const r = await minutaTav(u, id);
  if (!r) return new Response("Não encontrado", { status: 404 });
  return new Response(Buffer.from(r.bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(r.nome)}`, "Cache-Control": "private, no-store" },
  });
}
