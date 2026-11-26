import { usuarioAtual } from "@/lib/auth";
import { etapasAtivas } from "@/lib/fluxo";
import { levantamentoPesagem } from "@/lib/amostragem-nf";
import { pdfPlanoPesagem } from "@/lib/pdf-recebimento";

/** PDF do plano de contagem por pesagem por amostragem (somente o administrador geral). */
export async function GET(req: Request) {
  const u = await usuarioAtual();
  if (!u || u.deve_trocar_senha || u.papel !== "admin") return new Response("Não autorizado", { status: 401 });
  const sp = new URL(req.url).searchParams;
  const lista = (k: string) => (sp.get(k) ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const todas = await etapasAtivas();
  const ids = lista("etapas").filter((id) => todas.some((e) => e.id === id));
  const excluir = new Set(lista("excluir"));
  const tol = Math.min(50, Math.max(0, Number(String(sp.get("tol") ?? "2").replace(",", ".")) || 0));
  const nfs = await levantamentoPesagem(ids);
  const bytes = await pdfPlanoPesagem({
    geradoPor: u.nome, geradoEm: new Date(), tolerancia: tol, etapas: todas.filter((e) => ids.includes(e.id)).map((e) => e.nome).join(", ") || "—",
    nfs: nfs.filter((n) => !excluir.has(n.id)),
    excluidas: nfs.filter((n) => excluir.has(n.id)).map((n) => ({ numero: n.numero, empresa: n.empresa, volumes: n.volumes })),
  });
  return new Response(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Plano-contagem-por-pesagem.pdf"`, "Cache-Control": "private, no-store" },
  });
}
