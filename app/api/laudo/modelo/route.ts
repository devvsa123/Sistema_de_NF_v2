import { usuarioAtual } from "@/lib/auth";
import { exemploDoModelo, modeloAtual } from "@/lib/laudo";
import { exemploRecebimento } from "@/lib/recebimento";
import { ehDoc } from "@/lib/modelos-docs";

const MIME = { odt: "application/vnd.oasis.opendocument.text", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

/** Baixa o modelo atual de um documento (para editar) ou um exemplo preenchido (?exemplo=1). Somente administrador geral. */
export async function GET(req: Request) {
  const u = await usuarioAtual();
  if (!u || u.papel !== "admin" || u.deve_trocar_senha) return new Response("Não autorizado", { status: 401 });
  const sp = new URL(req.url).searchParams;
  const doc = ehDoc(sp.get("doc")) ? (sp.get("doc") as "laudo_pericial" | "tav" | "checklist") : "laudo_pericial";
  const exemplo = sp.get("exemplo") === "1";
  const modelo = await modeloAtual(doc);
  const ext = /\.odt$/i.test(modelo.nome) ? "odt" : "docx";
  let bytes: Uint8Array = modelo.arquivo;
  if (exemplo) bytes = doc === "laudo_pericial" ? await exemploDoModelo() : (await exemploRecebimento(doc)).bytes;
  const nome = `${exemplo ? "exemplo" : "modelo"}-${doc.replace("_", "-")}.${ext}`;
  return new Response(Buffer.from(bytes), { headers: { "Content-Type": MIME[ext], "Content-Disposition": `attachment; filename="${nome}"`, "Cache-Control": "private, no-store" } });
}
