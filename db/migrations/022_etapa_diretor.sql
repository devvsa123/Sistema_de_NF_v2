-- Nova etapa "Diretor", logo depois da Encarregadoria Técnica e antes da Contagem.
do $$
declare tec record;
begin
  if exists (select 1 from etapas where ativo and (nome ilike 'diretor%' or setor ilike 'diretor%')) then return; end if;
  select id, ordem into tec from etapas where ativo and (nome ilike 'enc%t_cnica%' or setor ilike 'enc%t_cnica%') order by ordem limit 1;
  if tec.id is null then
    insert into etapas (nome, setor, prazo_dias, ordem) values ('Diretor', 'Diretor', 2, (select coalesce(max(ordem), 0) + 1 from etapas where ativo));
  else
    update etapas set ordem = ordem + 1 where ativo and ordem > tec.ordem;
    insert into etapas (nome, setor, prazo_dias, ordem) values ('Diretor', 'Diretor', 2, tec.ordem + 1);
  end if;
end $$;
