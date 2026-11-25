-- NF Parcial: recebida a menor (volumes a menor no TAV ou quantidade a menor no Check-list da Contagem).
-- Recalculada a cada emissão de TAV/Check-list; aparece em destaque na fila, na pesquisa e na NF.
alter table notas add column if not exists parcial boolean not null default false;
alter table notas add column if not exists parcial_motivo text;
