import { sincronizarDoGithub } from "@/lib/estoque";

/** Atualização diária das planilhas do WMS (agendada em vercel.json). Protegida por CRON_SECRET. */
export async function GET(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.get("authorization") !== `Bearer ${segredo}`) return new Response("Não autorizado", { status: 401 });
  try {
    return Response.json(await sincronizarDoGithub());
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : "erro" }, { status: 500 });
  }
}
