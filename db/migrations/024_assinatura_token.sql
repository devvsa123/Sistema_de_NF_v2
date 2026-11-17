-- Assinatura com o token pelo Assinador SERPRO: o sistema prepara o PDF com o espaço da assinatura no campo
-- escolhido, o Assinador assina o resumo e o sistema encaixa a assinatura, confere e anexa na NF.
create table assinaturas_token (
  id                serial primary key,
  usuario_id        integer not null references usuarios(id) on delete cascade,
  nota_id           integer not null references notas(id) on delete cascade,
  registro_id       integer not null references docs_recebimento(id) on delete cascade,
  doc               text not null check (doc in ('tav', 'checklist')),
  campo             text not null,
  nome_arquivo      text not null,
  pdf               bytea,            -- PDF preparado (apagado depois de concluído)
  posicao           integer not null, -- onde fica o espaço da assinatura
  resumo            text not null,
  base_documento_id integer references documentos(id),
  criado_em         timestamptz not null default now(),
  concluido_em      timestamptz,
  documento_id      integer references documentos(id)
);
create index assinaturas_token_usuario on assinaturas_token (usuario_id, criado_em desc);
