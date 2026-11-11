# Sistema de Tramitação de NF — DepFMRJ

Substitui o sistema antigo em Streamlit + Google Planilhas (`controledepfard-v2`).

- **Next.js** (hospedagem gratuita na Vercel) + **Postgres** (gratuito no Neon)
- Cadastro de NF pelo **XML da NF-e** ou pelo **PDF da consulta no Portal da NF-e** (um ou vários arquivos), com dados e itens extraídos automaticamente
- **Fila de trabalho** por etapa, com semáforo de prazo e tramitação em lote
- **Caminho da tramitação configurável** pelo administrador; usuários só movem a NF uma etapa para frente ou para trás
- **Perfis de acesso**: administrador, interno (por etapa), consulta e fornecedor (vê apenas as NF do próprio CNPJ)
- **Pesquisa** por número, chave, empresa, OC, empenho, produto, período, valor, situação e atraso; exportação em CSV
- **Gerencial**: NF em cada setor por situação de prazo, as mais antigas de cada setor, evolução mensal dos tempos com tendência, NF despachadas por setor por dia e visão por fornecedor
- **Relatório mensal**: recebidas, finalizadas, reprovadas (%), tempo médio total e por etapa, por empresa
- **Importação** da planilha antiga (usuários, notas, histórico e observações)

## Como publicar (gratuito)

1. Em [vercel.com](https://vercel.com), crie um projeto importando este repositório do GitHub.
2. No projeto, abra **Storage → Create Database → Neon (Postgres)**, plano gratuito, região **São Paulo (sa-east-1)**, e conecte ao projeto.
   Isso cria a variável `DATABASE_URL` automaticamente.
3. Em **Settings → Functions**, escolha a região **São Paulo (gru1)** para ficar ao lado do banco.
4. Faça o **Deploy** (ou *Redeploy*). As tabelas são criadas sozinhas durante o build.
5. Abra o endereço do site: na primeira vez aparece a tela **Configuração inicial** para criar o administrador. Faça isso logo após publicar.
6. Em **Importar**, envie o `.xlsx` da planilha “Laboratório” (Arquivo → Fazer download → Microsoft Excel) e importe usuários e depois notas.

Os usuários entram com o mesmo NIP/CNPJ e a mesma senha do sistema antigo, e são obrigados a trocá-la no primeiro acesso.

## Desenvolvimento local

```bash
npm install
echo 'DATABASE_URL=postgres://postgres@localhost:5432/nf' > .env.local
DATABASE_URL=postgres://postgres@localhost:5432/nf npm run migrate
npm run dev
```

## Estrutura

| Pasta | Conteúdo |
| --- | --- |
| `db/migrations` | Estrutura do banco (aplicada por `scripts/migrate.mjs` a cada build) |
| `lib/auth.ts` | Login, sessão e perfis |
| `lib/fluxo.ts` | Regras de tramitação (quem pode mover o quê, para onde) |
| `lib/notas.ts` | Consultas e cadastro de NF; isolamento por CNPJ para fornecedores |
| `lib/nfe.ts` | Leitura do XML da NF-e |
| `lib/nfe-pdf.ts` | Leitura do PDF da consulta completa do Portal da NF-e |
| `lib/relatorios.ts` | Indicadores mensais |
| `lib/gerencial.ts` | Análises da área Gerencial |
| `lib/importar.ts` | Importação da planilha antiga |
| `app/` | Telas e ações |

## Ainda não incluído

- Agendamento de entregas (próxima etapa)
- Geração do relatório de perícia em `.docx`
- Análise das observações (aba “Análise de Problemas” do sistema antigo)
