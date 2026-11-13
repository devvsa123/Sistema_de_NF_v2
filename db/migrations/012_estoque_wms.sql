-- Integração com as planilhas do WMS (repositório do RPA no GitHub)

-- Catálogo de itens do estoque (controle-estoque.xlsx): um registro por PI
create table estoque_itens (
  pi            text primary key,
  descricao     text not null,
  cxp           integer,            -- quantidade padrão por caixa
  atualizado_em timestamptz not null default now()
);

-- Correlações confirmadas pelos usuários: o mesmo código/descrição do fornecedor volta a cair no mesmo PI
create table mapa_itens (
  emit_cnpj text not null,
  chave     text not null,          -- 'cod:<código do produto>' ou 'desc:<descrição normalizada>'
  pi        text not null,
  por       text,
  em        timestamptz not null default now(),
  primary key (emit_cnpj, chave)
);

-- ID de PA: número que identifica a NF no WMS
alter table notas add column id_pa text;
create index notas_id_pa on notas (id_pa);
update notas n set id_pa = d.dados->'formulario'->>'id_pa'
  from (select distinct on (nota_id) nota_id, dados from docs_recebimento order by nota_id, criado_em desc) d
 where d.nota_id = n.id and coalesce(d.dados->'formulario'->>'id_pa', '') <> '';

-- Alocação das UZ (paletes) por ID de PA — preenchida pela planilha do WMS, quando ela existir
create table wms_uz (
  id_pa         text not null,
  uz            text not null,
  loc           text not null,
  atualizado_em timestamptz not null default now(),
  primary key (id_pa, uz)
);

insert into config (chave, valor) values
  ('planilhas_repo', 'DepfmrjAbastecimento/planilhas'),
  ('planilhas_branch', 'main'),
  ('planilha_estoque', 'controle-estoque.xlsx'),
  ('planilha_uz', ''),
  ('loc_virtual', 'REC'),
  ('exigir_uz_alocadas', 'nao')
on conflict (chave) do nothing;
