-- Portal CMS · migração 7: papel da TV e Análise de Giro só do DEV
--
-- tv       a conta do Painel TV: lê os números do painel e a DISPO, mais nada.
-- pessoa   vendedor, cms ou dev — quem usa o portal de verdade.
--
-- Até aqui "qualquer login lê" era `using (true)`. Com a TV logada, isso
-- passa a ser "qualquer pessoa lê" (sou_pessoa), para a conta da TV não
-- enxergar produtos, campanhas, rateio etc.

alter table cadastro.perfis drop constraint if exists perfis_papel_check;
alter table cadastro.perfis add constraint perfis_papel_check
  check (papel in ('vendedor', 'cms', 'dev', 'tv'));

create or replace function sistema.sou_pessoa() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(sistema.meu_papel() in ('vendedor', 'cms', 'dev'), false)
$$;
create or replace function sistema.sou_tv() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(sistema.meu_papel() = 'tv', false)
$$;
grant execute on function sistema.sou_pessoa(), sistema.sou_tv() to authenticated;

-- Toda leitura aberta a "qualquer login" vira "qualquer pessoa"
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies
           where cmd = 'SELECT' and qual = 'true' and 'authenticated' = any(roles)
             and schemaname in ('cadastro', 'repasse', 'fabrica', 'carteira', 'catalogo', 'matriz', 'relatorios', 'sistema')
  loop
    execute format('alter policy %I on %I.%I using (sistema.sou_pessoa())', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- Documentos: pessoas leem; Análise de Giro só o DEV; a TV só o painel
drop policy if exists ler on sistema.documentos;
create policy ler on sistema.documentos for select to authenticated using (
  case
    when chave like 'giro/%' then sistema.sou_dev()
    when chave in ('v2/tv_data', 'v2/widget_performance') then sistema.sou_pessoa() or sistema.sou_tv()
    else sistema.sou_pessoa()
  end);

-- A TV mostra a DISPO (lotes em produção)
create policy tv_ler on fabrica.dispo for select to authenticated using (sistema.sou_tv());

-- O perfil da TV
insert into cadastro.perfis (codigo, nome, papel, email)
values ('TV', 'PAINEL TV', 'tv', 'painel-tv@cms69.com.br')
on conflict (codigo) do update set papel = 'tv', email = excluded.email;
