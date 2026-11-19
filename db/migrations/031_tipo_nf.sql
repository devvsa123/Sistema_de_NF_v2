-- NF de material ou de serviço (identificada pelo CFOP dos itens / natureza da operação; pode ser corrigida).
alter table notas add column if not exists tipo_nf text not null default 'material' check (tipo_nf in ('material', 'servico'));
alter table notas add column if not exists tipo_nf_motivo text;

update notas n set tipo_nf = 'servico', tipo_nf_motivo = 'pelo CFOP de industrialização / prestação de serviço'
where jsonb_typeof(n.itens) = 'array' and jsonb_array_length(n.itens) > 0
  and exists (select 1 from jsonb_array_elements(n.itens) i where right(i->>'cfop', 3) in ('124', '125', '933'))
  and not exists (select 1 from jsonb_array_elements(n.itens) i where right(i->>'cfop', 3) not in ('124', '125', '933', '902', '903', '925'));

update notas set tipo_nf = 'servico', tipo_nf_motivo = 'pela natureza da operação'
where tipo_nf = 'material' and (itens is null or jsonb_typeof(itens) <> 'array' or jsonb_array_length(itens) = 0)
  and (natureza ilike '%industrializa%para outra empresa%' or natureza ilike '%industrializa%encomenda%' or natureza ilike '%presta%servi%');
