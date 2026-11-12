-- Quem emite o laudo pericial: os usuários da etapa marcada como "emite laudo" (a Perícia)
alter table etapas add column emite_laudo boolean not null default false;
update etapas set emite_laudo = true where permite_reprovar and ativo;
