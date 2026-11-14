-- Documentos da NF (NF/DANFE, OC, laudos do fornecedor, TAV, Check-list, relatório de ensaio, laudo pericial...).
create table tipos_documento (
  id                serial primary key,
  nome              text not null unique,
  exige_assinatura  boolean not null default false, -- só conta como entregue com assinatura digital íntegra
  ordem             integer not null default 0,
  ativo             boolean not null default true
);
insert into tipos_documento (nome, exige_assinatura, ordem) values
  ('Nota fiscal (DANFE)', false, 1),
  ('Ordem de compra (OC)', false, 2),
  ('Laudos do fornecedor', false, 3),
  ('TAV', true, 4),
  ('Check-list de Recebimento', true, 5),
  ('Relatório de ensaio visual', true, 6),
  ('Laudo pericial', true, 7),
  ('Outros', false, 99);

-- Documentos obrigatórios para a NF sair de cada etapa (configurado pelo administrador).
create table etapa_documentos (
  etapa_id integer not null references etapas(id) on delete cascade,
  tipo_id  integer not null references tipos_documento(id) on delete cascade,
  primary key (etapa_id, tipo_id)
);

create table documentos (
  id                serial primary key,
  nota_id           integer not null references notas(id) on delete cascade,
  tipo_id           integer not null references tipos_documento(id),
  nome_arquivo      text not null,
  mime              text not null,
  tamanho           integer not null,
  sha256            text not null,
  armazenamento     text not null check (armazenamento in ('banco', 'r2')),
  chave             text,          -- caminho no armazenamento externo (R2)
  conteudo          bytea,         -- quando guardado no próprio banco
  assinaturas       jsonb not null default '[]',
  enviado_por       integer references usuarios(id),
  enviado_por_nome  text,
  criado_em         timestamptz not null default now(),
  removido_em       timestamptz,
  removido_por_nome text,
  motivo_remocao    text
);
create index documentos_nota on documentos (nota_id, criado_em) where removido_em is null;
