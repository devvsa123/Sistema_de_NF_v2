-- Check-list de Recebimento passa a se chamar Check-list da Contagem (itens com peso e discrepância por item).
update tipos_documento set nome = 'Check-list da Contagem' where nome = 'Check-list de Recebimento';
