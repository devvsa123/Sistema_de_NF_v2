import Link from "next/link";
import type { ReactNode } from "react";
import { exigirUsuario, podeCadastrar, type Usuario } from "@/lib/auth";
import { etapasAtivas, prazoReprovada } from "@/lib/fluxo";
import { Cabecalho } from "@/components/ui";

export const metadata = { title: "Manual do usuário — Tramitação de NF" };

type Papel = Usuario["papel"];
type Secao = { id: string; titulo: string; para: Papel[]; conteudo: ReactNode };

const TODOS: Papel[] = ["admin", "interno", "consulta", "empresa"];
const INTERNOS: Papel[] = ["admin", "interno", "consulta"];
const OPERADORES: Papel[] = ["admin", "interno"];

function Passos({ children }: { children: ReactNode }) {
  return <ol className="my-3 list-decimal space-y-1.5 pl-5 marker:font-semibold marker:text-slate-400">{children}</ol>;
}
function Lista({ children }: { children: ReactNode }) {
  return <ul className="my-3 list-disc space-y-1.5 pl-5 marker:text-slate-300">{children}</ul>;
}
function Dica({ children, tipo = "dica" }: { children: ReactNode; tipo?: "dica" | "atencao" }) {
  return (
    <p className={`my-4 rounded-lg border-l-4 px-4 py-3 text-sm ${tipo === "atencao" ? "border-amber-400 bg-amber-50 text-amber-900" : "border-sky-400 bg-sky-50 text-sky-900"}`}>
      <strong>{tipo === "atencao" ? "Atenção: " : "Dica: "}</strong>{children}
    </p>
  );
}
const B = ({ children }: { children: ReactNode }) => <strong className="font-semibold text-slate-900">{children}</strong>;
const Ir = ({ href, children }: { href: string; children: ReactNode }) => <Link href={href} className="font-medium text-marinha underline decoration-marinha/30 underline-offset-2 hover:decoration-marinha">{children}</Link>;

export default async function Manual() {
  const u = await exigirUsuario();
  const [etapas, prazoReprov] = await Promise.all([etapasAtivas(), prazoReprovada()]);
  const caminho = ["Cadastro", ...etapas.map((e) => e.nome), "Finalizada"].join(" → ");
  const reprova = etapas.filter((e) => e.permite_reprovar).map((e) => e.nome).join(", ") || "—";
  const arrecada = etapas.filter((e) => e.exige_arrecadacao).map((e) => e.nome).join(", ") || "—";
  const armazena = etapas.filter((e) => e.faz_armazenagem).map((e) => e.nome).join(", ") || "—";

  const secoes: Secao[] = [
    {
      id: "acesso", titulo: "Acesso e senha", para: TODOS, conteudo: <>
        <p>Entre com o seu <B>NIP</B> (militares e servidores) ou o <B>CNPJ da empresa</B> (fornecedores), com ou sem pontuação, e a sua senha.</p>
        <Lista>
          <li>No primeiro acesso o sistema pede uma <B>nova senha</B>, com pelo menos 8 caracteres.</li>
          <li>Para trocar a senha depois, use <B>Trocar senha</B> no rodapé do menu lateral.</li>
          <li>Depois de 5 tentativas erradas o acesso fica bloqueado por 15 minutos.</li>
          <li>Esqueceu a senha? Procure o administrador do sistema, que define uma senha provisória.</li>
          <li>A sessão expira após 12 horas. Use <B>Sair</B> ao terminar, principalmente em computadores compartilhados.</li>
        </Lista>
      </>,
    },
    {
      id: "perfis", titulo: "Perfis de acesso", para: INTERNOS, conteudo: <>
        <Lista>
          <li><B>Usuário interno</B>: tramita as NF nas etapas em que foi habilitado e consulta todas as notas. Alguns também cadastram NF ou tratam as reprovadas.</li>
          <li><B>Consulta</B>: vê todas as notas, a área Gerencial e os relatórios, sem tramitar.</li>
          <li><B>Fornecedor</B>: vê somente as NF emitidas pelo próprio CNPJ, sem observações internas.</li>
          <li><B>Administrador</B>: acesso total, inclusive caminho da tramitação, usuários e ajustes.</li>
        </Lista>
      </>,
    },
    {
      id: "caminho", titulo: "Como a NF tramita", para: INTERNOS, conteudo: <>
        <p>Caminho atual, definido pelo administrador:</p>
        <p className="my-3 rounded-lg bg-slate-50 px-4 py-3 font-medium text-slate-800">{caminho}</p>
        <Lista>
          <li>A NF só pode ser enviada <B>uma etapa para frente</B> ou <B>devolvida uma etapa para trás</B>.</li>
          <li>Cada etapa tem um <B>prazo</B> em dias. O semáforo mostra 🟢 dentro do prazo, 🟡 acima de 70% do prazo e 🔴 prazo estourado.</li>
          <li>Pode reprovar: <B>{reprova}</B>. Exige marcar “arrecadada” antes de finalizar: <B>{arrecada}</B>. Marca “armazenada”: <B>{armazena}</B>.</li>
          <li>Material <B>sob medida</B> entra direto na etapa configurada para isso.</li>
          <li>Tudo fica registrado no histórico da NF: quem fez, quando e com qual observação.</li>
        </Lista>
      </>,
    },
    {
      id: "fila", titulo: "Minha fila: tramitar notas", para: OPERADORES, conteudo: <>
        <p>Em <Ir href="/">Minha fila</Ir> aparecem as NF paradas nas etapas em que você atua, uma aba para cada etapa, com o número de notas ao lado. As mais antigas ficam no topo.</p>
        <Passos>
          <li>Abra a aba da etapa.</li>
          <li>Marque as NF que vai movimentar (a caixa do cabeçalho marca todas). Use o filtro para achar por número, empresa ou OC.</li>
          <li>Se quiser, escreva uma <B>observação</B>; ela vai para o histórico de todas as NF marcadas.</li>
          <li>Clique em <B>Enviar para …</B> (próxima etapa) ou <B>← Devolver para …</B> (etapa anterior).</li>
        </Passos>
        <p>Também é possível tramitar uma NF pela própria página dela, no quadro <B>Tramitar</B>.</p>
        <Dica>Se outra pessoa movimentou a NF enquanto você estava com a tela aberta, o sistema recusa a ação e avisa. Basta atualizar a página.</Dica>
      </>,
    },
    {
      id: "reprovacao", titulo: "Reprovação e NF reprovadas", para: OPERADORES, conteudo: <>
        <Passos>
          <li>Na etapa que permite reprovar, marque as NF e clique em <B>Reprovar</B>.</li>
          <li>Informe se a reprovação foi na perícia <B>visual</B> e/ou <B>laboratorial</B> e escreva o <B>motivo</B> (obrigatório).</li>
          <li>Clique em <B>Confirmar reprovação</B>.</li>
        </Passos>
        <p>As reprovadas ficam na aba <B>Reprovadas</B>, com prazo de {prazoReprov} dias para retirada. Nela você pode:</p>
        <Lista>
          <li><B>← Voltar para (etapa)</B>: a NF deixa de ser reprovada e volta para a etapa em que foi reprovada.</li>
          <li><B>Retirada pelo fornecedor</B>: encerra a NF.</li>
        </Lista>
      </>,
    },
    {
      id: "laudo", titulo: "Laudo pericial", para: ["admin", "interno"], conteudo: <>
        <p>Somente os usuários da <B>Perícia</B> emitem o laudo, pelo botão <B>Laudo</B> ao lado da NF na fila da Perícia, ou por <B>Emitir laudo pericial</B> na página da NF.</p>
        <Passos>
          <li>Informe o protocolo, o lote e a fabricação.</li>
          <li>Marque o resultado da perícia visual, se as medidas estão de acordo (com explicação quando não estão) e as observações.</li>
          <li>Marque o resultado da perícia laboratorial e, quando houver, o ofício ao SENAI e as datas de envio e recebimento.</li>
          <li>Clique em <B>Emitir laudo e baixar</B>. O arquivo do Word é baixado já preenchido com os dados da NF e o nome do Diretor.</li>
        </Passos>
        <Lista>
          <li>O laudo fica registrado no histórico da NF e pode ser baixado de novo na página da nota.</li>
          <li>Para corrigir, emita um novo laudo: o formulário já vem preenchido com o anterior.</li>
          <li>Emitir o laudo não movimenta a NF; a tramitação (avançar ou reprovar) continua sendo feita na fila.</li>
        </Lista>
      </>,
    },
    {
      id: "arrecadacao", titulo: "Arrecadação e armazenagem", para: OPERADORES, conteudo: <>
        <Lista>
          <li>Na etapa <B>{arrecada}</B>, use <B>Marcar como arrecadada</B> antes de finalizar. Sem isso, o botão de avançar não aparece.</li>
          <li>As NF arrecadadas e ainda não armazenadas aparecem na aba <B>Para armazenar</B> de quem atua em <B>{armazena}</B>. Marque-as e clique em <B>Marcar como armazenada</B>.</li>
        </Lista>
      </>,
    },
    {
      id: "cadastro", titulo: "Cadastrar notas fiscais", para: ["admin", "interno"], conteudo: <>
        <p>Em <Ir href="/notas/nova">Cadastrar NF</Ir>, arraste um ou vários arquivos. O sistema lê emitente, valor, itens, empenho e OC automaticamente e mostra uma prévia antes de gravar.</p>
        <p className="mt-3 font-semibold text-slate-900">Com o XML da NF-e</p>
        <p>Use o arquivo .xml enviado pelo fornecedor. É a forma mais completa.</p>
        <p className="mt-3 font-semibold text-slate-900">Sem o XML: PDF da consulta na SEFAZ</p>
        <Passos>
          <li>Acesse o Portal da NF-e (nfe.fazenda.gov.br) → <B>Consultar NF-e</B> → informe a chave de acesso.</li>
          <li>Na consulta completa, clique em imprimir e escolha <B>Salvar como PDF</B>.</li>
          <li>Envie esse PDF na tela de cadastro, como faria com o XML.</li>
        </Passos>
        <Dica tipo="atencao">O DANFE enviado pelo fornecedor não serve: só o PDF da consulta completa do Portal da NF-e é lido. O sistema confere a chave de acesso e a soma dos itens e recusa arquivos inconsistentes.</Dica>
        <Lista>
          <li>Confira a <B>OC</B> sugerida e marque <B>Sob medida</B> quando for o caso, depois clique em <B>Cadastrar</B>.</li>
          <li>Se a NF já existir sem os dados (por exemplo, importada da planilha antiga), o arquivo é <B>anexado</B> a ela sem alterar a tramitação.</li>
          <li>Sem XML nem PDF? Use <B>Cadastrar manualmente</B> no fim da página.</li>
        </Lista>
      </>,
    },
    {
      id: "pesquisa", titulo: "Pesquisar notas", para: TODOS, conteudo: <>
        <p>Em <Ir href="/notas">{u.papel === "empresa" ? "Minhas notas" : "Notas fiscais"}</Ir>, a pesquisa livre aceita número da NF, chave de acesso, {u.papel === "empresa" ? "" : "empresa, CNPJ, "}OC e empenho. Combine com situação, período de recebimento e faixa de valor.</p>
        <Lista>
          {u.papel !== "empresa" && <li><B>Somente fora do prazo</B> mostra as NF atrasadas em qualquer etapa.</li>}
          <li><B>Exportar planilha (CSV)</B> baixa o resultado para abrir no Excel.</li>
          <li>Clique no número da NF para ver a página completa.</li>
        </Lista>
      </>,
    },
    {
      id: "itens", titulo: "Pesquisar itens das notas", para: TODOS, conteudo: <>
        <p>Na aba <Ir href="/notas/itens">Itens das notas</Ir>, digite o produto procurado, por exemplo <B>camisa M</B>, <B>gandola camuflado G</B> ou <B>calça 42</B>.</p>
        <Lista>
          <li>A busca considera o nome do produto, a <B>descrição completa</B> informada pela empresa e o código.</li>
          <li>Acentos são ignorados e palavras parecidas também são encontradas (“camisa” acha “camiseta”).</li>
          <li>Tamanhos e números curtos (P, M, G, GG, 42) precisam aparecer como palavra inteira.</li>
          <li>O resultado mostra cada item com quantidade e valores, agrupado pela NF, e o total encontrado.</li>
        </Lista>
        <Dica>Só aparecem itens das NF que têm XML ou PDF da consulta anexado.</Dica>
      </>,
    },
    {
      id: "detalhe", titulo: "Página da NF", para: TODOS, conteudo: <>
        <Lista>
          <li><B>Caminho da tramitação</B>: em que etapa a NF está, quando passou por cada uma e quanto tempo ficou.</li>
          <li><B>Dados da NF-e</B> e <B>Itens da nota</B>, quando há XML ou PDF anexado. <B>Baixar XML</B> aparece quando o XML foi enviado.</li>
          <li><B>{u.papel === "empresa" ? "Movimentações" : "Histórico e observações"}</B>: todas as movimentações{u.papel === "empresa" ? "" : ", com usuário e observações"}.</li>
          {u.papel !== "empresa" && u.papel !== "consulta" && <li><B>Nova observação</B>: registra um comentário no histórico sem movimentar a NF.</li>}
        </Lista>
      </>,
    },
    {
      id: "gerencial", titulo: "Gerencial", para: INTERNOS, conteudo: <>
        <Lista>
          <li><B>Visão geral</B>: NF em cada setor por situação do prazo, as 10 mais antigas de cada setor e os números do período escolhido.</li>
          <li><B>Alertas</B>: o que pede ação agora — NF paradas há mais do dobro do prazo, setores acumulando, NF ultrapassadas na fila, reprovadas sem retirada, arrecadadas sem armazenagem, idas e voltas e NF que devem estourar o prazo total.</li>
          <li><B>Fluxo e gargalos</B>: quanto entrou e saiu de cada setor, a fila hoje, a espera prevista para quem chega (lei de Little) e o gargalo atual; o estoque de NF por setor dia a dia; chegadas × saídas por semana.</li>
          <li><B>Fila (FIFO)</B>: se cada setor está despachando na ordem de chegada, quais NF foram ultrapassadas por outras mais novas e o envelhecimento da fila por faixa de dias.</li>
          <li><B>Previsão</B>: data prevista de finalização de cada NF em trâmite, pelo tempo típico das etapas que faltam, e quantas devem finalizar em 7, 15 e 30 dias.</li>
          <li><B>Retrabalho</B>: devoluções e reprovações por setor, percentual de NF finalizadas de primeira e as NF com idas e voltas.</li>
          <li><B>Tempos de tramitação</B>: evolução mês a mês do tempo total ou de um setor, com a faixa onde está a maioria das NF e a tendência (aumento ou redução).</li>
          <li><B>Produtividade diária</B>: quantas NF cada setor despachou por dia no período, média por dia útil e quem tramitou.</li>
          <li><B>Fornecedores</B>: NF recebidas, valores, reprovação e tempo médio por empresa.</li>
        </Lista>
        <Dica>Passe o mouse sobre os gráficos para ver os valores exatos.</Dica>
      </>,
    },
    {
      id: "relatorio", titulo: "Relatório mensal", para: INTERNOS, conteudo: <>
        <p>Em <Ir href="/relatorios">Relatório mensal</Ir>, escolha o mês para ver NF recebidas, finalizadas e reprovadas (com percentuais), tempo médio de tramitação, tempo por etapa, comparação com os últimos 12 meses, resumo por empresa e as reprovações do mês. Use <B>Imprimir / PDF</B> para gerar o documento.</p>
      </>,
    },
    {
      id: "admin", titulo: "Administração", para: ["admin"], conteudo: <>
        <p className="font-semibold text-slate-900">Caminho da tramitação</p>
        <Lista>
          <li>Renomeie etapas, ajuste prazos e use ▲ ▼ para mudar a ordem. As mudanças valem na hora.</li>
          <li>Marque em cada etapa se ela pode reprovar, se os usuários dela emitem o laudo pericial, se exige arrecadação, se marca armazenagem e se é a entrada do material sob medida.</li>
          <li>Uma etapa só pode ser removida quando não houver NF nela.</li>
        </Lista>
        <p className="mt-3 font-semibold text-slate-900">Usuários</p>
        <Lista>
          <li>Crie usuários, defina o perfil e, para internos, as etapas em que tramitam e se cadastram NF ou tratam reprovadas.</li>
          <li>Para redefinir a senha de alguém, preencha <B>Nova senha</B> e mantenha marcado <B>Exigir troca de senha</B>.</li>
          <li>Desmarque <B>Usuário ativo</B> para bloquear o acesso sem apagar o histórico.</li>
        </Lista>
        <p className="mt-3 font-semibold text-slate-900">Modelo do laudo</p>
        <Lista>
          <li>Em <Ir href="/admin/laudo">Modelo do laudo</Ir>, altere os <B>campos fixos</B> (nome, posto e cargo do Diretor e o tratamento na resolução) e salve. Os próximos laudos saem com os novos valores; os já emitidos mantêm os da época.</li>
          <li>Você pode criar campos fixos novos (ex.: nome do Encarregado da Divisão Técnica) e usá-los no Word com o marcador entre chaves duplas, como {"{{encarregado_nome}}"}.</li>
          <li>Para mudar o texto ou o layout, baixe o modelo atual, edite no Word, salve como .docx e envie. Use <B>Baixar exemplo preenchido</B> para conferir e <B>Restaurar modelo padrão</B> se algo der errado.</li>
        </Lista>
        <p className="mt-3 font-semibold text-slate-900">Ajuste do administrador</p>
        <p>Na página da NF, o quadro <B>Ajuste do administrador</B> coloca a NF em qualquer etapa ou situação, para corrigir erros. O motivo é obrigatório e fica no histórico.</p>
        <p className="mt-3 font-semibold text-slate-900">Importar planilha</p>
        <p>Importa usuários e notas da planilha do sistema antigo. Pode ser repetida sem duplicar registros.</p>
      </>,
    },
    {
      id: "fornecedor", titulo: "Para fornecedores", para: ["empresa"], conteudo: <>
        <Lista>
          <li>Em <Ir href="/notas">Minhas notas</Ir> você acompanha a situação de cada NF emitida pela sua empresa.</li>
          <li><B>Enviada para o COMRJ</B> significa que a tramitação no Depósito foi concluída.</li>
          <li><B>Reprovada</B> indica que o material não foi aceito; entre em contato com o Depósito para as providências de retirada e reposição.</li>
        </Lista>
      </>,
    },
    {
      id: "duvidas", titulo: "Dúvidas frequentes", para: TODOS, conteudo: <dl className="space-y-4">
        {(u.papel === "admin" || u.papel === "interno") && <div><dt className="font-semibold text-slate-900">Não vejo nenhuma aba em Minha fila.</dt><dd>Seu usuário ainda não foi associado a nenhuma etapa. Peça ao administrador.</dd></div>}
        {(u.papel === "admin" || u.papel === "interno") && <div><dt className="font-semibold text-slate-900">Tramitei uma NF para o lugar errado.</dt><dd>Quem está na etapa seguinte pode devolvê-la. Em outros casos, o administrador corrige pelo Ajuste do administrador.</dd></div>}
        {podeCadastrar(u) && <div><dt className="font-semibold text-slate-900">O PDF da SEFAZ foi recusado.</dt><dd>Confira se é a consulta completa do Portal da NF-e (não o DANFE) e se todas as páginas foram salvas.</dd></div>}
        <div><dt className="font-semibold text-slate-900">Uma NF não aparece na pesquisa.</dt><dd>Limpe os filtros e pesquise só pelo número. {u.papel === "empresa" ? "Só aparecem notas emitidas pelo CNPJ da sua empresa." : "Se ainda assim não aparecer, ela pode não ter sido cadastrada."}</dd></div>
        <div><dt className="font-semibold text-slate-900">Os horários estão diferentes.</dt><dd>Todas as datas e horas do sistema seguem o horário de Brasília.</dd></div>
      </dl>,
    },
  ];
  const visiveis = secoes.filter((s) => s.para.includes(u.papel));

  return (
    <div>
      <Cabecalho titulo="Manual do usuário" descricao="Como usar o sistema de tramitação de notas fiscais. O conteúdo abaixo mostra apenas o que se aplica ao seu perfil." />
      <div className="grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav className="lg:sticky lg:top-8 lg:self-start print:hidden">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Neste manual</p>
          <ol className="space-y-0.5 border-l border-slate-200 text-sm">
            {visiveis.map((s) => (
              <li key={s.id}><a href={`#${s.id}`} className="-ml-px block border-l border-transparent py-1 pl-3 text-slate-600 hover:border-marinha hover:text-marinha">{s.titulo}</a></li>
            ))}
          </ol>
        </nav>
        <div className="max-w-3xl space-y-5">
          {visiveis.map((s, i) => (
            <section key={s.id} id={s.id} className="cartao scroll-mt-6 p-6 text-[15px] leading-relaxed text-slate-700">
              <h2 className="mb-3 flex items-baseline gap-3 text-lg font-semibold tracking-tight text-slate-900">
                <span className="text-sm font-medium tabular-nums text-slate-400">{String(i + 1).padStart(2, "0")}</span>{s.titulo}
              </h2>
              {s.conteudo}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
