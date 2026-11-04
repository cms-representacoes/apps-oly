-- Portal CMS · migração 8: o resumo do repasse para o Painel TV
--
-- A TV mostra o ranking de repasse dos últimos 30 dias e o saldo real da
-- DISPO (saldo menos o que já está reservado em pedido). Hoje ela baixa
-- todos os pedidos, com clientes, para fazer essa conta. Aqui o banco
-- entrega só o resultado: a conta da TV não lê pedido nenhum.

create or replace function repasse.resumo_tv()
returns jsonb
language sql stable security definer set search_path = '' as $$
with
ped as (
  select p.*,
    case when lower(trim(p.status)) in ('aprovado', 'finalizado', 'faturado') then 'Aprovado'
         when lower(trim(p.status)) in ('cancelado', 'cancelada') then 'Cancelado'
         else 'Pendente' end as st
  from repasse.pedidos p
),
-- pares do item: totalUnits; sem ele, a soma da grade (como a TV fazia)
itens as (
  select i.pedido_id, coalesce(nullif(trim(coalesce(i.gci, '')), ''), i.artigo) as chave,
    coalesce(nullif(i.pares, 0),
      (select coalesce(sum((g ->> 'qty')::numeric), 0) from jsonb_array_elements(
         case when jsonb_typeof(i.grade) = 'array' then i.grade else '[]'::jsonb end) g))::numeric as pares
  from repasse.pedido_itens i
),
vend as (
  select coalesce(p.preposto_nome, p.preposto) as nome, count(distinct p.id) as pedidos,
         coalesce(sum(i.pares), 0) as pares
  from ped p left join itens i on i.pedido_id = p.id
  where p.st <> 'Cancelado' and coalesce(p.criado_em, p.atualizado_em) >= now() - interval '30 days'
  group by 1
)
select case when sistema.sou_tv() or sistema.sou_pessoa() then jsonb_build_object(
  'vend', (select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'pedidos', pedidos, 'pares', pares)
             order by pares desc), '[]') from vend where pedidos > 0),
  'reservado', (select coalesce(jsonb_object_agg(chave, total), '{}') from (
      select i.chave, sum(i.pares) as total from itens i join ped p on p.id = i.pedido_id
      where p.st <> 'Cancelado' and i.chave is not null group by 1) r))
end
$$;

revoke execute on function repasse.resumo_tv() from public, anon;
grant execute on function repasse.resumo_tv() to authenticated;
grant usage on schema repasse to authenticated;
