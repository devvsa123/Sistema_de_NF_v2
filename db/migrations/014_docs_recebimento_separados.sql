-- TAV e Check-list passam a ser emitidos separadamente (em momentos diferentes).
-- Registros antigos continuam com os dois documentos ('ambos').
alter table docs_recebimento add column doc text not null default 'ambos' check (doc in ('tav', 'checklist', 'ambos'));
