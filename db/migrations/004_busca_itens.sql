-- Busca aproximada nos itens das NF: ignora acentos e aceita palavras parecidas (camisa ≈ camiseta)
create extension if not exists unaccent;
create extension if not exists pg_trgm;
