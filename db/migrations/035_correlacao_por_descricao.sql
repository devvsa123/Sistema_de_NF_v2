-- A correlação aprendida passa a usar só a descrição completa do item. As chaves pelo código do fornecedor
-- são removidas: o mesmo código pode ser usado para vários tamanhos (P, M, G) e espalhava a correção de um para os outros.
-- As confirmações continuam valendo pela chave da descrição (gravada junto, em cada confirmação).
delete from mapa_itens where chave like 'cod:%';
