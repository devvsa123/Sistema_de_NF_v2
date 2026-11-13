import Link from "next/link";
import type { ReactNode } from "react";
import { exigirUsuario, podeCadastrar, podeGerirUsuarios, type Usuario } from "@/lib/auth";
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
          <li><B>Administrador geral</B>: acesso total, inclusive caminho da tramitação, modelo do laudo, importação, usuários e ajustes.</li>
          <li><B>Administrador de usuários</B>: além do próprio perfil (interno ou consulta), cadastra e edita usuários e empresas. Não altera administradores nem as configurações do sistema.</li>
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
      id: "docs-recebimento", titulo: "TAV e Check-list de Recebimento", para: ["admin", "interno"], conteudo: <>
        <p>O <B>Recebimento</B> (e o administrador geral) emite o TAV (Termo de Abertura de Volumes) e o Check-list de Recebimento enquanto a NF está em <B>Pré Recebimento</B> ou <B>Contagem</B>, pelo botão <B>TAV / Check-list</B> ao lado da NF na fila ou pelos botões <B>Emitir TAV</B> e <B>Emitir Check-list</B> na página da NF.</p>
        <Passos>
          <li>Confira o <B>número do TAV</B> (o sistema sugere o próximo do ano) e a data do recebimento; informe ID do PA, lote, fabricação e volumes.</li>
          <li>Marque se a conferência foi por contagem manual ou pesagem e responda SIM ou NÃO às perguntas do TAV.</li>
          <li>No Check-list, informe o peso de um volume, itens por caixa, a data de envio da amostra e se houve discrepância na contagem.</li>
          <li>Os dois documentos são emitidos separadamente, cada um com o seu botão: <B>Emitir TAV</B> no Pré Recebimento e, depois, <B>Emitir Check-list</B> na Contagem. O Check-list usa o número, a data e a identificação do último TAV da NF, por isso só fica disponível depois do TAV.</li>
        </Passos>
        <Lista>
          <li>Os documentos ficam registrados no histórico da NF e podem ser baixados de novo na página da nota.</li>
          <li>Para corrigir, emita novamente: o formulário já vem preenchido com o registro anterior. O mesmo número de TAV não pode ser usado em outra NF no mesmo ano.</li>
          <li>Lote e fabricação informados no TAV já aparecem preenchidos no laudo pericial.</li>
          <li>O TAV sai com a <B>Relação de itens para contagem</B>: cada item da NF (ou cada tamanho da grade) com o PI e a descrição do estoque, a quantidade, o CXP e o plano de caixas (cheias, fracionada e total), além das colunas em branco <B>Qtd. contada</B> e <B>Cx. contadas</B>. Basta imprimir o TAV para fazer a contagem.</li>
          <li>A relação é montada no momento do download, com a correlação atual: se um item for corrigido no quadro <B>Itens × estoque</B>, baixe o TAV de novo. Linhas sem correlação ou sem CXP vêm marcadas para conferência.</li>
          <li>A assinatura de <B>Responsável pelo pré-recebimento</B> sai com o nome de <B>quem baixou/imprimiu</B> o TAV, que responde pelo pré-recebimento da NF.</li>
        </Lista>
      </>,
    },
    {
      id: "estoque", titulo: "Itens × estoque (WMS) e plano de caixas", para: ["admin", "interno", "consulta"], conteudo: <>
        <p>Na página de cada NF com itens (XML ou PDF), o quadro <B>Itens × estoque (WMS)</B> liga cada item da nota ao item do estoque e calcula as caixas pelo padrão de caixa (<B>CXP</B>) do WMS.</p>
        <Lista>
          <li>Exemplo: 101 unidades com CXP 20 = <B>5 caixas cheias + 1 fracionada com 1 unidade</B> = 6 caixas.</li>
          <li><B>PI na nota</B>: o fornecedor informou o PI. <B>Confirmada</B>: alguém já confirmou essa correlação para o fornecedor. <B>Automática</B>: a descrição bate com segurança. <B>Verificar</B>: a correlação é provável, confira. <B>Sem correlação</B>: nenhum item do estoque corresponde.</li>
          <li>Para corrigir, use <B>Escolher item do estoque</B>, <B>Confirmar ou trocar</B> ou <B>Trocar</B>: escolha uma sugestão, pesquise no catálogo ou digite o PI. A escolha vale para as próximas NF do mesmo fornecedor.</li>
          <li>O total de caixas pelo padrão aparece ao lado dos volumes declarados na NF, para ajudar na contagem.</li>
          <li>Quando o fornecedor informa a <B>grade de tamanhos</B> no item (ex.: “GRADE (36/05) (50/01) (54/02)” = 5 peças tamanho 36, 1 tamanho 50 e 2 tamanho 54), o item é <B>quebrado por tamanho</B>: cada tamanho ganha o seu PI e o seu cálculo de caixas, e o sistema avisa se a soma da grade não bater com a quantidade da nota.</li>
        </Lista>
        <p className="mt-3 font-semibold text-slate-900">Alocação no WMS (ID de PA e UZ)</p>
        <Lista>
          <li>O <B>ID de PA</B> é preenchido pelo TAV e pode ser informado ou corrigido no quadro <B>Alocação no WMS</B> da NF. Também dá para pesquisar a NF pelo ID de PA.</li>
          <li>Quando a planilha de alocação das UZ estiver disponível e a exigência estiver ligada, a estocagem só consegue marcar a NF como armazenada depois que todas as UZ do ID de PA saírem da LOC virtual (REC).</li>
        </Lista>
      </>,
    },
    {
      id: "laudo", titulo: "Laudo pericial", para: ["admin", "interno"], conteudo: <>
        <p>Somente os usuários da <B>Perícia</B> (e o administrador geral) emitem o laudo, pelo botão <B>Laudo</B> ao lado da NF na fila da Perícia, ou por <B>Emitir laudo pericial</B> na página da NF.</p>
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
          <li>O sistema procura a <B>OC</B> nos dados adicionais da nota (escrita como “OC”, “O.C.”, “Ordem de Compra” ou “Pedido”, sempre com 7 dígitos) e preenche sozinha. Quando a nota não informa a OC, o campo fica em destaque e é preciso digitá-la: <B>nenhuma NF é cadastrada sem OC</B>.</li>
          <li>Marque <B>Sob medida</B> quando for o caso e clique em <B>Cadastrar</B>.</li>
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
          <li><B>Caminho da tramitação</B>: em que etapa a NF está{u.papel === "empresa" ? "" : ", quando passou por cada uma e quanto tempo ficou"}.</li>
          <li><B>Dados da NF-e</B> e <B>Itens da nota</B>, quando há XML ou PDF anexado. <B>Baixar XML</B> aparece quando o XML foi enviado.</li>
          {u.papel === "empresa"
            ? <li><B>Situação atual</B> e data da <B>última movimentação</B> da NF.</li>
            : <li><B>Histórico e observações</B>: todas as movimentações, com usuário e observações.</li>}
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
          <li>Renomeie etapas, ajuste prazos, defina o <B>setor</B> de cada etapa (etapas com o mesmo setor são atribuídas juntas aos usuários) e use ▲ ▼ para mudar a ordem. As mudanças valem na hora.</li>
          <li>Marque em cada etapa se ela pode reprovar, se os usuários dela emitem o laudo pericial ou o TAV e Check-list, se exige arrecadação, se marca armazenagem e se é a entrada do material sob medida.</li>
          <li>Uma etapa só pode ser removida quando não houver NF nela.</li>
        </Lista>
        <p className="mt-3 font-semibold text-slate-900">Usuários</p>
        <Lista>
          <li>Crie usuários, defina o perfil e, para internos, os <B>setores</B> em que trabalham (o usuário recebe todas as etapas do setor; o Recebimento inclui Pré Recebimento, Contagem e Reprovadas) e se cadastram NF.</li>
          <li>Para redefinir a senha de alguém, preencha <B>Nova senha</B> e mantenha marcado <B>Exigir troca de senha</B>.</li>
          <li>Desmarque <B>Usuário ativo</B> para bloquear o acesso sem apagar o histórico.</li>
          <li>Use a <B>pesquisa</B> no topo da lista para achar alguém pelo nome, NIP ou CNPJ, e os filtros de perfil, setor e situação.</li>
          <li>Somente o administrador geral pode <B>excluir</B> um usuário (botão no fim da tela de edição). O histórico das NF continua com o nome dele.</li>
        </Lista>
        <p className="mt-3 font-semibold text-slate-900">Modelos de documentos</p>
        <Lista>
          <li>Em <Ir href="/admin/laudo">Modelos de documentos</Ir>, altere os <B>campos fixos</B> (nome, posto e cargo do Diretor e o tratamento na resolução) e salve. Os próximos laudos saem com os novos valores; os já emitidos mantêm os da época.</li>
          <li>Você pode criar campos fixos novos (ex.: nome do Encarregado da Divisão Técnica) e usá-los no Word com o marcador entre chaves duplas, como {"{{encarregado_nome}}"}.</li>
          <li>Para mudar o texto ou o layout do laudo, do TAV ou do Check-list, escolha o documento, baixe o modelo atual, edite no Word ou no LibreOffice, salve como .docx ou .odt e envie. Use <B>Baixar exemplo preenchido</B> para conferir e <B>Restaurar modelo padrão</B> se algo der errado.</li>
        </Lista>
        <p className="mt-3 font-semibold text-slate-900">Estoque (WMS)</p>
        <Lista>
          <li>Em <Ir href="/admin/estoque">Estoque (WMS)</Ir> fica a integração com as planilhas do RPA no GitHub: o catálogo do estoque é atualizado automaticamente todo dia às 6h, ou na hora pelo botão <B>Atualizar agora do GitHub</B>. Também é possível importar o arquivo manualmente.</li>
          <li>Ali se configura a planilha de alocação das UZ, a LOC virtual (REC) e a exigência de todas as UZ alocadas para armazenar.</li>
        </Lista>
        <p className="mt-3 font-semibold text-slate-900">Ajuste do administrador</p>
        <p>Na página da NF, o quadro <B>Ajuste do administrador</B> coloca a NF em qualquer etapa ou situação, para corrigir erros. O motivo é obrigatório e fica no histórico.</p>
        <p className="mt-3 font-semibold text-slate-900">Importar planilha</p>
        <p>Importa usuários e notas da planilha do sistema antigo. Pode ser repetida sem duplicar registros.</p>
      </>,
    },
    ...(u.papel !== "admin" && podeGerirUsuarios(u) ? [{
      id: "usuarios", titulo: "Cadastro de usuários e empresas", para: INTERNOS, conteudo: <>
        <p>Como <B>administrador de usuários</B>, você acessa <Ir href="/admin/usuarios">Usuários e empresas</Ir> no menu lateral.</p>
        <Lista>
          <li><B>Novo usuário</B>: informe nome, login (NIP ou CNPJ), perfil e senha inicial. Para usuários internos, marque os setores em que trabalham (o Recebimento já inclui Pré Recebimento, Contagem e Reprovadas).</li>
          <li><B>Empresa (fornecedor)</B>: crie um usuário com perfil Fornecedor e o CNPJ da empresa como login. Ele verá apenas as NF desse CNPJ.</li>
          <li>Para redefinir a senha de alguém, preencha <B>Nova senha</B> e mantenha marcado <B>Exigir troca de senha</B>.</li>
          <li>Administradores não podem ser criados nem alterados por você; isso cabe ao administrador geral.</li>
        </Lista>
      </>,
    } satisfies Secao] : []),
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
