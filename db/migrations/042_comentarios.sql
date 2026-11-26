-- Separa os comentários dos usuários das mensagens geradas pelo sistema (log para auditoria).
alter table eventos add column if not exists comentario boolean not null default false;
-- comentários: observações e o texto que a pessoa digitou ao tramitar/cadastrar (não as decisões automáticas do parecer)
update eventos set comentario = true
where texto is not null and btrim(texto) <> ''
  and (tipo = 'observacao'
       or (tipo in ('avanco', 'retorno', 'reprovacao', 'cadastro', 'retirada', 'finalizacao', 'arrecadacao', 'armazenagem')
           and texto not like 'Resolução do Sr. Diretor%' and texto not like 'Parecer do Encarregado%'));
create index if not exists eventos_comentarios on eventos (nota_id, criado_em) where comentario;
