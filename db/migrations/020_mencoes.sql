-- Marcação de usuários e setores nas observações da NF (mensagens).
alter table eventos add column marcados text; -- como aparece no histórico: "@Perícia, @CT Fulano"

create table mencoes (
  id         serial primary key,
  evento_id  integer not null references eventos(id) on delete cascade,
  nota_id    integer not null references notas(id) on delete cascade,
  usuario_id integer not null references usuarios(id) on delete cascade, -- quem recebe
  setor      text,                                                       -- preenchido quando veio pela marcação do setor
  autor_id   integer references usuarios(id),
  autor_nome text,
  criado_em  timestamptz not null default now(),
  lida_em    timestamptz,
  unique (evento_id, usuario_id)
);
create index mencoes_pendentes on mencoes (usuario_id, criado_em desc) where lida_em is null;
create index mencoes_usuario on mencoes (usuario_id, criado_em desc);
create index mencoes_autor on mencoes (autor_id, criado_em desc);
