-- Setores: agrupam etapas. O usuário é cadastrado por setor e recebe todas as etapas dele.
-- O Recebimento reúne Pré Recebimento e Contagem e também trata as NF reprovadas.
alter table etapas add column setor text;
update etapas set setor = 'Recebimento' where lower(nome) in ('pré recebimento', 'pre recebimento', 'contagem');
update etapas set setor = nome where setor is null;
alter table etapas alter column setor set not null;

insert into config (chave, valor) values ('setor_reprovadas', 'Recebimento')
  on conflict (chave) do nothing;

-- quem já tinha alguma etapa do Recebimento passa a ter todas elas e a tratar as reprovadas
insert into usuario_etapas (usuario_id, etapa_id)
  select distinct ue.usuario_id, e2.id
  from usuario_etapas ue join etapas e1 on e1.id = ue.etapa_id and e1.ativo
  join etapas e2 on e2.setor = e1.setor and e2.ativo
on conflict do nothing;
update usuarios u set trata_reprovadas = true
  where exists (select 1 from usuario_etapas ue join etapas e on e.id = ue.etapa_id and e.ativo and e.setor = 'Recebimento' where ue.usuario_id = u.id);
