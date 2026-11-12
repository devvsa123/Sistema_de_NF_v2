import { usuarioAtual } from "@/lib/auth";
import { exemploDoModelo, modeloAtual } from "@/lib/laudo";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Baixa o modelo atual (para editar no Word) ou um exemplo preenchido (?exemplo=1). Somente administrador. */
export async function GET(req: Request) {
  const u = await usuarioAtual();
  if (!u || u.papel !== "admin" || u.deve_trocar_senha) return new Response("Não autorizado", { status: 401 });
  const exemplo = new URL(req.url).searchParams.get("exemplo") === "1";
  const bytes = exemplo ? await exemploDoModelo() : (await modeloAtual()).arquivo;
  const nome = exemplo ? "exemplo-laudo-pericial.docx" : "modelo-laudo-pericial.docx";
  return new Response(Buffer.from(bytes), { headers: { "Content-Type": DOCX, "Content-Disposition": `attachment; filename="${nome}"`, "Cache-Control": "private, no-store" } });
}
