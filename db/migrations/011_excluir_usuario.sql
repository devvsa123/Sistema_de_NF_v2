-- Permite excluir usuários: os registros que ele fez continuam no sistema, só perdem o vínculo
-- (o histórico de tramitação já guarda o nome de quem fez cada movimentação).
alter table notas            drop constraint notas_criado_por_fkey,            add constraint notas_criado_por_fkey            foreign key (criado_por)     references usuarios(id) on delete set null;
alter table nota_xml         drop constraint nota_xml_enviado_por_fkey,        add constraint nota_xml_enviado_por_fkey        foreign key (enviado_por)    references usuarios(id) on delete set null;
alter table eventos          drop constraint eventos_usuario_id_fkey,          add constraint eventos_usuario_id_fkey          foreign key (usuario_id)     references usuarios(id) on delete set null;
alter table modelos          drop constraint modelos_atualizado_por_fkey,      add constraint modelos_atualizado_por_fkey      foreign key (atualizado_por) references usuarios(id) on delete set null;
alter table laudos           drop constraint laudos_criado_por_fkey,           add constraint laudos_criado_por_fkey           foreign key (criado_por)     references usuarios(id) on delete set null;
alter table docs_recebimento drop constraint docs_recebimento_criado_por_fkey, add constraint docs_recebimento_criado_por_fkey foreign key (criado_por)     references usuarios(id) on delete set null;

-- laudos e documentos guardam o nome de quem emitiu, para continuar aparecendo depois da exclusão
alter table laudos add column criado_por_nome text;
update laudos l set criado_por_nome = u.nome from usuarios u where u.id = l.criado_por;
alter table docs_recebimento add column criado_por_nome text;
update docs_recebimento d set criado_por_nome = u.nome from usuarios u where u.id = d.criado_por;
