-- Vice-Diretor: responde pelo Diretor no impedimento dele. Ao assinar no lugar do Diretor,
-- o selo e o histórico registram "no impedimento do Diretor".
alter table usuarios add column if not exists vice_diretor boolean not null default false;
alter table assinaturas_token add column if not exists substituicao text;

-- campos fixos do Vice-Diretor (aparecem em Modelos de documentos, como os do Diretor)
update config set valor = (
  select jsonb_agg(c)::text from (
    select c from jsonb_array_elements(valor::jsonb) c
    union all select x from jsonb_array_elements('[
      {"chave": "vice_nome", "rotulo": "Nome do(a) Vice-Diretor(a) (vazio = nome do certificado)", "valor": ""},
      {"chave": "vice_posto", "rotulo": "Posto do(a) Vice-Diretor(a)", "valor": ""},
      {"chave": "vice_cargo", "rotulo": "Cargo (Vice-Diretor / Vice-Diretora)", "valor": "Vice-Diretor"}
    ]'::jsonb) x
    where not exists (select 1 from jsonb_array_elements(valor::jsonb) e where e->>'chave' = x->>'chave')
  ) s
) where chave = 'laudo_campos';
