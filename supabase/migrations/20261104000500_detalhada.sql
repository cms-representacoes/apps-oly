-- Portal CMS · migração 5: a base da Detalhada no formato da tela
--
-- A Detalhada trabalha com a base compacta (dicionários + linhas de índices)
-- que o script diário publica em data/detalhada.json. Esta função remonta o
-- mesmo formato a partir das tabelas, para a tela trocar só a origem.
--
-- security invoker: o RLS vale aqui dentro. O vendedor recebe só as linhas
-- dele (e o movimento e a primeira previsão dos clientes dele); CMS e DEV
-- recebem tudo.

-- Monta a base de um preposto (null = todos). Roda na carga da noite, não
-- na abertura da tela: o resultado fica pronto em carteira.base_pronta.
create or replace function carteira.montar_base(p_preposto text)
returns jsonb
language sql stable set search_path = '' as $$
with
meta as (select dados from sistema.documentos where chave = 'detalhada/meta'),
-- Uma passada só: cada valor ganha o seu número no dicionário pela ordem
-- alfabética (dense_rank). Sem cruzar tabelas linha a linha.
l as (
  select d.*,
    dense_rank() over (order by coalesce(preposto_nome, '')) - 1                    as i_prep,
    dense_rank() over (order by coalesce(cliente, ''), coalesce(cliente_nome, '')) - 1 as i_cli,
    dense_rank() over (order by coalesce(marca, '')) - 1                            as i_marca,
    dense_rank() over (order by coalesce(fabrica, '')) - 1                          as i_fab,
    dense_rank() over (order by coalesce(filial, '')) - 1                           as i_fil,
    dense_rank() over (order by coalesce(referencia, ''), coalesce(descricao, '')) - 1 as i_ref,
    dense_rank() over (order by coalesce(cor, '')) - 1                              as i_cor,
    dense_rank() over (order by oc nulls last) - 1                                  as i_oc,     -- sem OC = -1, abaixo
    dense_rank() over (order by faixa nulls last) - 1                               as i_faixa,  -- sem faixa = -1
    dense_rank() over (order by coalesce(cod_comercial, '')) - 1                    as i_comer,
    dense_rank() over (order by coalesce(cod_financeiro, '')) - 1                   as i_finan
  from carteira.detalhada d
  where p_preposto is null or d.preposto = p_preposto
),
mv as (
  select m.*,
    dense_rank() over (order by coalesce(referencia, ''), coalesce(descricao, '')) - 1 as i_ref,
    dense_rank() over (order by coalesce(cor, '')) - 1                              as i_cor,
    dense_rank() over (order by coalesce(cliente, ''), coalesce(cliente_nome, '')) - 1 as i_cli,
    dense_rank() over (order by coalesce(preposto_nome, '')) - 1                    as i_prep,
    dense_rank() over (order by coalesce(marca, '')) - 1                            as i_marca,
    dense_rank() over (order by coalesce(faixa, '')) - 1                            as i_faixa
  from carteira.movimento m
  where p_preposto is null or m.preposto = p_preposto
)
select (select dados - 'mov' - 'prev0' from meta) || jsonb_build_object(
  'dic', jsonb_build_object(
    'prep',  (select coalesce(jsonb_agg(v order by i), '[]') from (select distinct i_prep i, coalesce(preposto_nome, '') v from l) x),
    'cli',   (select coalesce(jsonb_agg(jsonb_build_array(c, n) order by i), '[]') from (select distinct i_cli i, coalesce(cliente, '') c, coalesce(cliente_nome, '') n from l) x),
    'marca', (select coalesce(jsonb_agg(v order by i), '[]') from (select distinct i_marca i, coalesce(marca, '') v from l) x),
    'faixa', (select coalesce(jsonb_agg(v order by i), '[]') from (select distinct i_faixa i, faixa v from l where faixa is not null) x),
    'fab',   (select coalesce(jsonb_agg(v order by i), '[]') from (select distinct i_fab i, coalesce(fabrica, '') v from l) x),
    'fil',   (select coalesce(jsonb_agg(v order by i), '[]') from (select distinct i_fil i, coalesce(filial, '') v from l) x),
    'ref',   (select coalesce(jsonb_agg(jsonb_build_array(r, n) order by i), '[]') from (select distinct i_ref i, coalesce(referencia, '') r, coalesce(descricao, '') n from l) x),
    'cor',   (select coalesce(jsonb_agg(v order by i), '[]') from (select distinct i_cor i, coalesce(cor, '') v from l) x),
    'oc',    (select coalesce(jsonb_agg(v order by i), '[]') from (select distinct i_oc i, oc v from l where oc is not null) x),
    'comer', (select coalesce(jsonb_agg(v order by i), '[]') from (select distinct i_comer i, coalesce(cod_comercial, '') v from l) x),
    'finan', (select coalesce(jsonb_agg(v order by i), '[]') from (select distinct i_finan i, coalesce(cod_financeiro, '') v from l) x)),
  'l', coalesce((select jsonb_agg(jsonb_build_array(
      i_prep, i_cli, i_marca, i_fab, i_fil, i_ref, i_cor,
      case when gci ~ '^\d+$' then gci::bigint else 0 end,
      case when nf  ~ '^\d+$' then nf::bigint  else 0 end,
      case when oc is null then -1 else i_oc end,
      coalesce(prev_fat - date '1970-01-01', 0), cart, fat,
      coalesce(data_fat - date '1970-01-01', 0),
      case when faixa is null then -1 else i_faixa end,
      i_comer, i_finan) order by id) from l), '[]'),
  'mov', (select dados -> 'mov' from meta) || jsonb_build_object(
    'dic', jsonb_build_object(
      'ref',   (select coalesce(jsonb_agg(jsonb_build_array(r, n) order by i), '[]') from (select distinct i_ref i, coalesce(referencia, '') r, coalesce(descricao, '') n from mv) x),
      'cor',   (select coalesce(jsonb_agg(v order by i), '[]') from (select distinct i_cor i, coalesce(cor, '') v from mv) x),
      'cli',   (select coalesce(jsonb_agg(jsonb_build_array(c, n) order by i), '[]') from (select distinct i_cli i, coalesce(cliente, '') c, coalesce(cliente_nome, '') n from mv) x),
      'prep',  (select coalesce(jsonb_agg(v order by i), '[]') from (select distinct i_prep i, coalesce(preposto_nome, '') v from mv) x),
      'marca', (select coalesce(jsonb_agg(v order by i), '[]') from (select distinct i_marca i, coalesce(marca, '') v from mv) x),
      'faixa', (select coalesce(jsonb_agg(v order by i), '[]') from (select distinct i_faixa i, coalesce(faixa, '') v from mv) x)),
    'ev', coalesce((select jsonb_agg(jsonb_build_array(
        dia - date '1970-01-01', tipo,
        case when gci ~ '^\d+$' then gci::bigint else 0 end,
        i_ref, i_cor, i_cli, i_prep, i_marca, i_faixa,
        coalesce(prev_fat - date '1970-01-01', -1),
        quantidade, coalesce(motivo, ''), coalesce(fat_antes, 0)) order by id) from mv), '[]')),
  'prev0', (select dados -> 'prev0' from meta) || jsonb_build_object(
    'k', (select coalesce(jsonb_object_agg(chave, prev_fat - date '1970-01-01'), '{}') from carteira.primeira_previsao
          where p_preposto is null or cliente in (select cliente from l))))
$$;

-- As bases prontas: '*' é a completa (CMS e DEV); as outras, por código
create table if not exists carteira.base_pronta (
  chave     text primary key,
  gerado    text,
  base      jsonb not null,
  montada_em timestamptz not null default now()
);
alter table carteira.base_pronta enable row level security;
drop policy if exists ver on carteira.base_pronta;
create policy ver on carteira.base_pronta for select to authenticated
  using ((chave = '*' and sistema.sou_admin()) or chave = sistema.meu_codigo());
grant select on carteira.base_pronta to authenticated;

create or replace function carteira.preparar_bases()
returns integer
language plpgsql set search_path = '' as $$
declare n integer := 0; p record;
begin
  delete from carteira.base_pronta;
  insert into carteira.base_pronta (chave, gerado, base)
    select '*', b ->> 'gerado', b from (select carteira.montar_base(null) b) x;
  for p in select codigo from cadastro.perfis where papel = 'vendedor' loop
    insert into carteira.base_pronta (chave, gerado, base)
      select p.codigo, b ->> 'gerado', b from (select carteira.montar_base(p.codigo) b) x;
    n := n + 1;
  end loop;
  return n + 1;
end $$;

-- O que a tela chama: a base de quem está logado
create or replace function carteira.base_detalhada()
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select base from carteira.base_pronta
   where chave = case when sistema.sou_admin() then '*' else sistema.meu_codigo() end
$$;

-- "Mudou?" sem baixar a base: só o cabeçalho
create or replace function carteira.base_detalhada_info()
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select dados - 'mov' - 'prev0' from sistema.documentos where chave = 'detalhada/meta'
$$;

revoke execute on function carteira.montar_base(text), carteira.preparar_bases() from public, anon, authenticated;
revoke execute on function carteira.base_detalhada(), carteira.base_detalhada_info() from public, anon;
grant execute on function carteira.base_detalhada(), carteira.base_detalhada_info() to authenticated;
grant usage on schema carteira to authenticated;
