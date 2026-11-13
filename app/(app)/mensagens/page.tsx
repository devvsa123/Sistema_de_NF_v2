import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { mensagensEnviadas, mensagensRecebidas } from "@/lib/mencoes";
import { dataHora } from "@/lib/format";
import { Cabecalho, Vazio } from "@/components/ui";
import { BotaoCiente } from "@/components/BotaoCiente";

export const metadata = { title: "Mensagens — Tramitação de NF" };

export default async function Mensagens({ searchParams }: PageProps<"/mensagens">) {
  const u = await exigirUsuario();
  if (u.papel !== "admin" && u.papel !== "interno") redirect("/notas");
  const aba = (await searchParams).aba === "enviadas" ? "enviadas" : "recebidas";
  const [recebidas, enviadas] = await Promise.all([mensagensRecebidas(u), mensagensEnviadas(u)]);
  const pendentes = recebidas.filter((m) => !m.lida_em).length;
  const aba_ = (chave: string, rotulo: string, n?: number) => (
    <Link href={`/mensagens${chave === "enviadas" ? "?aba=enviadas" : ""}`}
      className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${aba === chave ? "bg-marinha text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}`}>
      {rotulo}{n ? <span className={`ml-1.5 rounded-full px-1.5 text-xs ${aba === chave ? "bg-white/20" : "bg-red-600 text-white"}`}>{n}</span> : null}
    </Link>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Cabecalho titulo="Mensagens" descricao="Observações em que você ou o seu setor foram marcados, e as que você enviou. Para escrever, use + Observação na fila ou Nova observação na página da NF e marque a pessoa ou o setor." />
      <div className="flex gap-2">{aba_("recebidas", "Recebidas", pendentes)}{aba_("enviadas", "Enviadas")}</div>

      {aba === "recebidas" ? (
        !recebidas.length ? <Vazio>Nenhuma mensagem recebida.</Vazio> : (
          <ol className="space-y-3">
            {recebidas.map((m) => (
              <li key={m.id} className={`cartao p-4 ${m.lida_em ? "" : "ring-2 ring-red-400"}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm">
                    <Link href={`/notas/${m.nota_id}`} className="font-bold text-marinha hover:underline">NF {m.numero}</Link>
                    <span className="text-slate-500"> · {m.empresa}</span>
                  </p>
                  <span className="text-xs text-slate-500">{dataHora(m.criado_em)}</span>
                </div>
                <p className="mt-1 text-xs text-slate-600">De <strong className="text-slate-800">{m.autor_nome ?? "—"}</strong>{m.setor ? <> para o setor <strong>{m.setor}</strong></> : " para você"}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-900">{m.texto}</p>
                <div className="mt-2 flex items-center gap-3 text-xs">
                  {m.lida_em ? <span className="text-emerald-700">Ciente em {dataHora(m.lida_em)}</span> : <BotaoCiente id={m.id} />}
                  <Link href={`/notas/${m.nota_id}`} className="font-medium text-marinha hover:underline">Abrir NF</Link>
                </div>
              </li>
            ))}
          </ol>
        )
      ) : !enviadas.length ? <Vazio>Você ainda não enviou mensagens.</Vazio> : (
        <ol className="space-y-3">
          {enviadas.map((m) => (
            <li key={m.evento_id} className="cartao p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm"><Link href={`/notas/${m.nota_id}`} className="font-bold text-marinha hover:underline">NF {m.numero}</Link><span className="text-slate-500"> · Para: {m.marcados}</span></p>
                <span className="text-xs text-slate-500">{dataHora(m.criado_em)}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-900">{m.texto}</p>
              <p className={`mt-2 text-xs ${m.cientes === m.total ? "text-emerald-700" : "text-amber-700"}`}>
                {m.cientes} de {m.total} deram ciente{m.pendentes ? ` · aguardando: ${m.pendentes}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
