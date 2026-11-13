-- No repositório de planilhas, o controle de estoque fica em dados_wms/.
update config set valor = 'dados_wms/controle-estoque.xlsx' where chave = 'planilha_estoque' and valor = 'controle-estoque.xlsx';
