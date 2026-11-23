-- Exigência do pacote final para finalizar a NF (liga/desliga em Administração → Documentos da NF).
-- Começa desligada: ainda há NF do trâmite antigo sem os documentos no sistema.
insert into config (chave, valor) values ('exigir_pacote_final', 'nao') on conflict (chave) do nothing;
