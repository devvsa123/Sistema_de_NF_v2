-- A pesquisa de NF passa a considerar também a descrição completa dos itens (informações adicionais do produto)
update notas n
   set busca = n.busca || ' ' || x.txt
  from (select id, lower(string_agg(i.value->>'infAd', ' ')) as txt
          from notas, jsonb_array_elements(case when jsonb_typeof(itens) = 'array' then itens else '[]'::jsonb end) i
         where i.value->>'infAd' is not null
         group by id) x
 where x.id = n.id;
