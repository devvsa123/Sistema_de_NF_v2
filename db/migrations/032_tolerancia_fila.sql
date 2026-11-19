-- Tolerância da fila (FIFO): NF que chegaram ao setor com até X dias de diferença podem sair em qualquer ordem
-- sem contar como "furar a fila". Valor padrão em config; cada etapa pode ter o seu (vazio = usa o padrão).
alter table etapas add column if not exists tolerancia_fila_dias numeric(5, 1) check (tolerancia_fila_dias is null or tolerancia_fila_dias between 0 and 365);
insert into config (chave, valor) values ('fifo_tolerancia_dias', '0') on conflict (chave) do nothing;
