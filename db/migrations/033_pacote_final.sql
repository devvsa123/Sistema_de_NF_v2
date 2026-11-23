-- Pacote final da NF: antes de finalizar, o Controle baixa todos os documentos assinados e o histórico (ZIP),
-- confere e confirma. Ao finalizar, os arquivos são excluídos do sistema; o histórico e os dados textuais ficam.
alter table notas add column if not exists pacote_conferido_em timestamptz;
alter table notas add column if not exists pacote_conferido_por text;
alter table notas add column if not exists pacote_docs jsonb;          -- [{id, sha256}] conferidos no pacote
alter table documentos add column if not exists arquivo_excluido_em timestamptz;
