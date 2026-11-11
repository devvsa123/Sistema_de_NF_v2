-- De onde vieram os dados detalhados da NF: 'xml' (arquivo da NF-e) ou 'pdf' (consulta impressa do Portal da NF-e)
alter table notas add column fonte text;
update notas set fonte = 'xml' where tem_xml;
