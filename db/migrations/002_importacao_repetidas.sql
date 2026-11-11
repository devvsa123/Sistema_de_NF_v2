-- A planilha antiga tem linhas repetidas da mesma NF (ex.: nova entrega após reprovação).
-- Cada linha passa a ter uma identificação própria, para que todas sejam importadas
-- e a importação continue podendo ser repetida sem duplicar.
alter table notas add column legado_chave text;
create unique index notas_legado_chave on notas (legado_chave) where legado_chave is not null;

update notas
   set legado_chave = coalesce(chave, '') || '|' || numero || '|' || emit_cnpj || '|' || valor::text || '|1'
 where origem = 'importacao';
