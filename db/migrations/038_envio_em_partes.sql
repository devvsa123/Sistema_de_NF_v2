-- Envio de arquivos grandes em partes (a Vercel limita cada requisição a ~4,5 MB): as partes ficam aqui
-- até o arquivo ser montado, conferido e guardado; depois são apagadas.
create table if not exists envios_partes (
  envio      uuid not null,
  parte      integer not null,
  usuario_id integer not null references usuarios(id) on delete cascade,
  dados      bytea not null,
  criado_em  timestamptz not null default now(),
  primary key (envio, parte)
);
create index if not exists envios_partes_criado on envios_partes (criado_em);
