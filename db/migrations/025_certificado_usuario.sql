-- Titular do certificado (token) de cada usuário, usado no selo visível das assinaturas feitas pelo sistema.
alter table usuarios add column cert_nome text;
alter table usuarios add column cert_cpf text;
alter table usuarios add column cert_emissor text;
alter table usuarios add column cert_em timestamptz;
