-- ID de PA na tramitação.
-- edita_id_pa: usuários da etapa informam/alteram o ID de PA enquanto a NF estiver nela (Pré Recebimento e Contagem);
--              a NF só sai dessas etapas com o ID de PA preenchido.
-- altera_id_pa_sempre: usuários da etapa alteram o ID de PA em qualquer momento (Controle).
alter table etapas add column edita_id_pa boolean not null default false;
alter table etapas add column altera_id_pa_sempre boolean not null default false;
update etapas set edita_id_pa = true where ativo and emite_docs_recebimento;
update etapas set altera_id_pa_sempre = true where ativo and setor = 'Controle';

-- Exigência só para as NF que estão hoje na primeira etapa que informa o ID de PA (Pré Recebimento) e para as novas;
-- as que já passaram dela seguem tramitando sem o ID de PA.
alter table notas add column exige_id_pa boolean not null default true;
update notas set exige_id_pa = false
 where not (status = 'em_tramite' and etapa_id = (select id from etapas where ativo and edita_id_pa order by ordem, id limit 1));
