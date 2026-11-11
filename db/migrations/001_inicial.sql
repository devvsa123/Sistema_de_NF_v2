-- Estrutura inicial do Sistema de Tramitação de NF

create table config (
  chave text primary key,
  valor text not null
);

-- Etapas do caminho de tramitação (definidas pelo administrador)
create table etapas (
  id                 serial primary key,
  nome               text not null,
  ordem              integer not null,
  prazo_dias         integer not null default 5,
  permite_reprovar   boolean not null default false,
  exige_arrecadacao  boolean not null default false,
  faz_armazenagem    boolean not null default false,
  entrada_sob_medida boolean not null default false,
  ativo              boolean not null default true
);
create unique index etapas_nome_ativo on etapas (lower(nome)) where ativo;

create table empresas (
  cnpj      text primary key,          -- somente dígitos
  nome      text not null,
  criado_em timestamptz not null default now()
);

create table usuarios (
  id                  serial primary key,
  login               text not null unique,   -- NIP ou CNPJ, somente dígitos
  nome                text not null,
  senha_hash          text,                   -- bcrypt
  senha_legado_sha256 text,                   -- senha importada do sistema antigo (trocada no 1º login)
  papel               text not null check (papel in ('admin','interno','consulta','empresa')),
  empresa_cnpj        text references empresas(cnpj),
  pode_cadastrar      boolean not null default false,
  trata_reprovadas    boolean not null default false,
  ativo               boolean not null default true,
  deve_trocar_senha   boolean not null default false,
  falhas_login        integer not null default 0,
  bloqueado_ate       timestamptz,
  criado_em           timestamptz not null default now(),
  check (papel <> 'empresa' or empresa_cnpj is not null)
);

create table usuario_etapas (
  usuario_id integer not null references usuarios(id) on delete cascade,
  etapa_id   integer not null references etapas(id) on delete cascade,
  primary key (usuario_id, etapa_id)
);

create table sessoes (
  token_hash text primary key,
  usuario_id integer not null references usuarios(id) on delete cascade,
  expira_em  timestamptz not null,
  criado_em  timestamptz not null default now()
);

create table notas (
  id            serial primary key,
  chave         text,                       -- chave de acesso (44 dígitos) ou NUP antigo
  numero        text not null,
  serie         text,
  emit_cnpj     text not null,              -- somente dígitos
  emit_nome     text not null,
  valor         numeric(14,2) not null default 0,
  oc            text,
  empenho       text,
  data_emissao  timestamptz,
  natureza      text,
  sob_medida    boolean not null default false,
  status        text not null check (status in ('em_tramite','reprovada','finalizada','retirada','arquivada')),
  etapa_id      integer references etapas(id),
  etapa_desde   timestamptz not null default now(),
  recebida_em   timestamptz not null default now(),
  concluida_em  timestamptz,
  arrecadada_em timestamptz,
  armazenada_em timestamptz,
  reprov_visual        text,
  reprov_laboratorial  text,
  obs_oc        text,
  tem_xml       boolean not null default false,
  dados         jsonb,                      -- resumo extraído do XML
  itens         jsonb,                      -- produtos do XML
  busca         text not null default '',   -- texto para pesquisa
  origem        text not null default 'sistema',
  criado_por    integer references usuarios(id),
  criado_em     timestamptz not null default now()
);
create index notas_status on notas (status, etapa_id);
create index notas_emit on notas (emit_cnpj);
create index notas_recebida on notas (recebida_em desc);
create index notas_chave on notas (chave);

-- XML completo fica separado para as listagens continuarem leves
create table nota_xml (
  nota_id     integer primary key references notas(id) on delete cascade,
  xml         text not null,
  enviado_em  timestamptz not null default now(),
  enviado_por integer references usuarios(id)
);

-- Histórico: toda movimentação e observação da NF
create table eventos (
  id            bigserial primary key,
  nota_id       integer not null references notas(id) on delete cascade,
  tipo          text not null,
  movimento     boolean not null default false,   -- true quando muda etapa/situação
  de_nome       text,
  para_etapa_id integer references etapas(id),
  para_status   text,
  para_nome     text,
  usuario_id    integer references usuarios(id),
  usuario_nome  text,
  texto         text,
  criado_em     timestamptz not null default now()
);
create index eventos_nota on eventos (nota_id, criado_em, id);
create index eventos_mov on eventos (criado_em) where movimento;

-- Quanto tempo cada NF ficou em cada etapa/situação
create view permanencias as
select nota_id,
       para_etapa_id as etapa_id,
       para_nome     as etapa_nome,
       para_status   as status,
       criado_em     as entrada,
       lead(criado_em) over (partition by nota_id order by criado_em, id) as saida
from eventos
where movimento;

-- Caminho padrão (o mesmo do sistema anterior); pode ser alterado em Administração > Caminho
insert into etapas (nome, ordem, prazo_dias, permite_reprovar, exige_arrecadacao, faz_armazenagem, entrada_sob_medida) values
  ('Pré Recebimento', 1,  2, false, false, false, false),
  ('Perícia',         2,  6, true,  false, false, false),
  ('Enc. Técnica',    3,  2, false, false, false, false),
  ('Contagem',        4, 20, false, false, false, false),
  ('Estocagem',       5,  3, false, false, true,  false),
  ('Controle',        6,  7, false, true,  false, true);

insert into config (chave, valor) values ('prazo_reprovada', '10');
