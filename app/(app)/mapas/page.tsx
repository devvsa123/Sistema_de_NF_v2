import Link from "next/link";
import { redirect } from "next/navigation";
import { ehInterno, exigirUsuario, podeCadastrar } from "@/lib/auth";
import { listarMapas } from "@/lib/notas";
import { data, dias } from "@/lib/format";
import { Cabecalho, Selo } from "@/components/ui";

export const metadata = { title: "Mapas de devolução — Tramitação de NF" };

/** Lista própria dos Mapas de devolução (fora da pesquisa de NF, do Gerencial e do Relatório). */
export default async function Mapas({ searchParams }: PageProps<"/mapas">) {
  const u = await exigirUsuario();
  if (!ehInterno(u)) redirect("/notas");
  const sp = await searchParams;
  const q = String(sp.q ?? ""), situacao = String(sp.situacao ?? "abertos");
  const mapas = await listarMapas({ q, situacao });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Cabecalho titulo="Mapas de devolução" descricao="Devoluções de material dos CAM, em trâmite próprio (mesmo caminho das NF, sem a exigência de documentos). Não entram na pesquisa de NF, no Gerencial nem no Relatório mensal." />
        <div className="flex gap-2">
          {(u.papel === "admin" || u.papel === "interno") && <Link href="/?cat=mapa" className="botao-sec h-9 text-sm">Fila de mapas</Link>}
          {podeCadastrar(u) && <Link href="/mapas/novo" className="botao h-9 text-sm">Cadastrar mapa</Link>}
        </div>
      </div>
      <form className="cartao flex flex-wrap items-end gap-3 p-4">
        <label className="min-w-64 flex-1"><span className="rotulo">Pesquisar (número ou CAM)</span><input name="q" defaultValue={q} className="campo" /></label>
        <label><span className="rotulo">Situação</span>
          <select name="situacao" defaultValue={situacao} className="campo">
            <option value="abertos">Em trâmite</option><option value="concluidos">Concluídos</option><option value="todos">Todos</option>
          </select></label>
        <button className="botao-sec h-10">Pesquisar</button>
      </form>
      <div className="cartao overflow-x-auto">
        {mapas.length === 0 ? <p className="p-5 text-sm text-slate-500">Nenhum mapa de devolução encontrado.</p> : (
          <table className="tabela">
            <thead><tr><th>Nº do mapa</th><th>CAM</th><th>Situação</th><th>Cadastrado</th><th>Na etapa há</th><th>Último comentário</th></tr></thead>
            <tbody>
              {mapas.map((m) => (
                <tr key={m.id}>
                  <td className="font-semibold"><Link href={`/notas/${m.id}?volta=${encodeURIComponent("/mapas")}`} className="text-marinha hover:underline">{m.numero}</Link></td>
                  <td className="max-w-64">{m.emit_nome}</td>
                  <td><Selo nota={m} /></td>
                  <td className="whitespace-nowrap">{data(m.recebida_em)}</td>
                  <td className="whitespace-nowrap">{m.status === "em_tramite" ? dias(m.dias_etapa) : "—"}</td>
                  <td className="max-w-80 text-xs text-slate-600"><span className="line-clamp-2">{m.ultima_obs ?? ""}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
