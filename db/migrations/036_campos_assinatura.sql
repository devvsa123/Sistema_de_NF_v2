-- Campos de assinatura de cada PDF anexado (nome, rótulo, assinado), lidos no envio: o check-list da NF mostra
-- as assinaturas que faltam sem precisar abrir os arquivos a cada visita. Vazio = ainda não lido.
alter table documentos add column if not exists campos jsonb;
