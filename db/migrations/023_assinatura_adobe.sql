-- Assinatura pelo Adobe com o Assistente de Assinatura (programa instalado no computador).
-- Cada clique em "Assinar no Adobe" cria um código de uso único que o Assistente usa para baixar o PDF e devolver o assinado.
create table assinaturas_pendentes (
  id           serial primary key,
  token_hash   text not null unique,
  usuario_id   integer not null references usuarios(id) on delete cascade,
  nota_id      integer not null references notas(id) on delete cascade,
  registro_id  integer not null references docs_recebimento(id) on delete cascade,
  doc          text not null check (doc in ('tav', 'checklist')),
  criado_em    timestamptz not null default now(),
  expira_em    timestamptz not null default now() + interval '45 minutes',
  baixado_em   timestamptz,
  enviado_em   timestamptz,
  documento_id integer references documentos(id),
  mensagem     text
);
create index assinaturas_pendentes_usuario on assinaturas_pendentes (usuario_id, criado_em desc);

-- Versão já anexada que recebe a próxima assinatura (ex.: TAV assinado pelo pré-recebimento, falta o encarregado).
alter table assinaturas_pendentes add column base_documento_id integer references documentos(id);
