-- 1) Encarregado do Abastecimento (Gestor de Bens Patrimoniais) depois do Controle; depois a NF volta ao Controle,
--    que finaliza. Como o caminho é linear, a volta é uma etapa "Controle — Finalização" do mesmo setor Controle
--    (os usuários do Controle passam a ter as duas).
do $$
declare ctl record; nova_ab integer; nova_fin integer;
begin
  if exists (select 1 from etapas where ativo and (nome ilike '%abastecimento%' or setor ilike '%abastecimento%')) then return; end if;
  select * into ctl from etapas where ativo and (setor ilike 'controle%' or nome ilike 'controle%') order by ordem desc limit 1;
  if ctl.id is null then return; end if;
  update etapas set ordem = ordem + 2 where ativo and ordem > ctl.ordem;
  insert into etapas (nome, setor, prazo_dias, ordem) values ('Enc. Abastecimento', 'Abastecimento', 2, ctl.ordem + 1) returning id into nova_ab;
  insert into etapas (nome, setor, prazo_dias, ordem, altera_id_pa_sempre) values ('Controle — Finalização', ctl.setor, ctl.prazo_dias, ctl.ordem + 2, ctl.altera_id_pa_sempre) returning id into nova_fin;
  -- quem é do Controle passa a ter também a etapa de finalização
  insert into usuario_etapas (usuario_id, etapa_id) select ue.usuario_id, nova_fin from usuario_etapas ue where ue.etapa_id = ctl.id on conflict do nothing;
end $$;

-- 2) Assinatura com token de qualquer documento anexado (não só TAV e Check-list)
alter table assinaturas_token alter column registro_id drop not null;
alter table assinaturas_token alter column doc drop not null;
alter table assinaturas_token drop constraint if exists assinaturas_token_doc_check;
alter table assinaturas_token add column documento_origem_id integer references documentos(id);
