-- Parecer da Divisão Técnica em PDF, com decisões na assinatura.
-- Reprovação indicada pela Perícia (ou pela Técnica): a NF segue o trâmite com destaque até a resolução do Diretor.
alter table notas add column indicacao_reprovacao text check (indicacao_reprovacao in ('pericia', 'tecnica'));
alter table assinaturas_token add column decisao jsonb;
alter table laudos add column documento_id integer references documentos(id);

-- quem reprova é o Diretor (pela resolução no parecer); Perícia e Técnica indicam a reprovação
update etapas set permite_reprovar = false where ativo and (setor ilike '%per_cia%' or nome ilike '%per_cia%' or setor ilike '%t_cnica%' or nome ilike '%t_cnica%');
update etapas set permite_reprovar = true where ativo and (setor ilike 'diretor%' or nome ilike 'diretor%');
