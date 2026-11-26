-- Mapas de devolução (devoluções dos CAM): mesmo caminho de tramitação das NF, mas trâmite separado,
-- sem as exigências de documentos, e fora da pesquisa de NF, do Gerencial e do Relatório mensal.
alter table notas add column if not exists categoria text not null default 'nf' check (categoria in ('nf', 'mapa'));
create index if not exists notas_categoria_status on notas (categoria, status, etapa_id);

-- visões só com as NF (usadas pelos indicadores do Gerencial e pelo Relatório mensal)
create or replace view notas_nf as select * from notas where categoria = 'nf';
create or replace view eventos_nf as select ev.* from eventos ev join notas n on n.id = ev.nota_id and n.categoria = 'nf';
create or replace view permanencias_nf as select p.* from permanencias p join notas n on n.id = p.nota_id and n.categoria = 'nf';

insert into tipos_documento (nome, exige_assinatura, ordem)
select 'Mapa de devolução', false, 9 where not exists (select 1 from tipos_documento where nome = 'Mapa de devolução');
