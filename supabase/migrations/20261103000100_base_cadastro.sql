-- Portal CMS · migração 1: base (sistema) e cadastro
--
-- Cada área do portal vive no seu schema. Nenhuma tabela fica aberta:
-- RLS ligado em todas, e o acesso é dado só pelas políticas abaixo.
-- Papéis: vendedor (só o que é dele), cms (tudo) e dev (tudo, e o único
-- que abre aplicação em desenvolvimento). Os scripts diários entram com a
-- chave de serviço, que passa por cima do RLS e nunca vai para as telas.

create schema if not exists sistema;
create schema if not exists cadastro;

-- ─────────────────────────────────────────────────────────────────────
-- Cadastro: perfis (quem usa o portal)
-- user_id fica vazio até a pessoa ganhar login no Auth.
-- ─────────────────────────────────────────────────────────────────────
create table cadastro.perfis (
  codigo      text primary key,                 -- código do preposto/comissionista
  nome        text not null,
  papel       text not null default 'vendedor'
              check (papel in ('vendedor', 'cms', 'dev')),
  email       text unique,
  user_id     uuid unique references auth.users (id) on delete set null,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
comment on table cadastro.perfis is 'Usuários do portal: vendedor, cms e dev. O código é o mesmo do EBM.';

-- Quem está pedindo: as políticas de todas as áreas usam estas duas.
-- security definer para ler perfis sem cair na própria política.
create or replace function sistema.meu_codigo() returns text
language sql stable security definer set search_path = '' as $$
  select codigo from cadastro.perfis where user_id = auth.uid() and ativo
$$;

create or replace function sistema.meu_papel() returns text
language sql stable security definer set search_path = '' as $$
  select papel from cadastro.perfis where user_id = auth.uid() and ativo
$$;

-- CMS e DEV veem e alteram tudo
create or replace function sistema.sou_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(sistema.meu_papel() in ('cms', 'dev'), false)
$$;

create or replace function sistema.vejo_tudo() returns boolean
language sql stable security definer set search_path = '' as $$
  select sistema.sou_admin()
$$;

-- Só o DEV abre aplicação em desenvolvimento
create or replace function sistema.sou_dev() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(sistema.meu_papel() = 'dev', false)
$$;

-- ─────────────────────────────────────────────────────────────────────
-- Sistema: auditoria (quem mudou o quê, e quando)
-- ─────────────────────────────────────────────────────────────────────
create table sistema.auditoria (
  id          bigint generated always as identity primary key,
  em          timestamptz not null default now(),
  tabela      text not null,
  operacao    text not null,                     -- INSERT / UPDATE / DELETE
  chave       text,
  antes       jsonb,
  depois      jsonb,
  user_id     uuid default auth.uid(),
  codigo      text default sistema.meu_codigo()
);
create index auditoria_tabela_em on sistema.auditoria (tabela, em desc);
comment on table sistema.auditoria is 'Registro automático de alterações nas tabelas auditadas. Só leitura para admin.';

create or replace function sistema.auditar() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  linha jsonb := to_jsonb(coalesce(new, old));
begin
  insert into sistema.auditoria (tabela, operacao, chave, antes, depois)
  values (
    tg_table_schema || '.' || tg_table_name,
    tg_op,
    coalesce(linha ->> tg_argv[0], linha ->> 'id', linha ->> 'codigo'),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create or replace function sistema.carimbar_atualizacao() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

-- Publicações dos scripts e importações do admin (substitui os *-info.json)
create table sistema.publicacoes (
  id          bigint generated always as identity primary key,
  base        text not null,                     -- detalhada, rfv, grade-corre...
  origem      text,                              -- nome da planilha de origem
  gerado_em   timestamptz,
  publicado_em timestamptz not null default now(),
  linhas      integer,
  por         text
);
create index publicacoes_base_em on sistema.publicacoes (base, publicado_em desc);

-- Status das aplicações (substitui app_status.json e vitrine_status.json)
create table sistema.status_app (
  app         text primary key,                  -- portal, vitrine...
  em_desenvolvimento boolean not null default false,  -- só o DEV abre
  pausado     boolean not null default false,
  mensagem    text not null default '',
  atualizado_em timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────
-- Cadastro: clientes
-- Um cliente pode estar na lista de mais de um vendedor, por isso o
-- vínculo fica numa tabela à parte.
-- ─────────────────────────────────────────────────────────────────────
create table cadastro.clientes (
  codigo          text primary key,
  razao           text,
  fantasia        text,
  cnpj            text,
  telefone        text,
  cidade          text,
  uf              text,
  porta           text,
  email_nfe       text,
  email_bancario  text,
  a_vista         boolean,
  lider_comercial text,                          -- COD. COMER da Detalhada
  lider_financeiro text,                         -- COD. FINAN da Detalhada
  atualizado_em   timestamptz not null default now()
);
create index clientes_cnpj on cadastro.clientes (cnpj);

create table cadastro.clientes_prepostos (
  cliente   text not null references cadastro.clientes (codigo) on delete cascade,
  preposto  text not null references cadastro.perfis (codigo) on update cascade,
  primary key (cliente, preposto)
);
create index clientes_prepostos_preposto on cadastro.clientes_prepostos (preposto);

-- ─────────────────────────────────────────────────────────────────────
-- Cadastro: produtos (artigo + cor é a chave em todo o portal)
-- ─────────────────────────────────────────────────────────────────────
create table cadastro.produtos (
  artigo          text not null,
  cor             text not null,
  marca           text not null,                 -- Olympikus / Under Armour
  descricao       text,
  categoria       text,
  segmento        text,
  linha           text,
  genero          text,
  faixa           text,                          -- CORRIDA/TREINO, CHINELOS...
  tamanhos        text,                          -- ex.: 34/48
  pdv             numeric(12, 2),
  custo           numeric(12, 4),
  imagem          text,
  canal_exclusivo text check (canal_exclusivo in ('DTC', 'ML', 'DTC+ML')),
  oculto          boolean not null default false,
  novidade_em     date,
  atualizado_em   timestamptz not null default now(),
  primary key (artigo, cor)
);
create index produtos_marca on cadastro.produtos (marca);
comment on column cadastro.produtos.canal_exclusivo is 'Produto de canal exclusivo: não entra na vitrine.';

-- Ficha técnica (Trade Squash / UA): o conteúdo varia por fonte, fica em jsonb
create table cadastro.fichas (
  chave     text primary key,                    -- artigo, ou artigo|cor
  marca     text,
  fonte     text,
  dados     jsonb not null,
  lido_em   timestamptz
);

create table cadastro.tabela_especial (
  id            bigint generated always as identity primary key,
  artigo        text not null,
  marca         text,
  codigo_tabela text not null,
  custo         numeric(14, 6),
  mkp           numeric(8, 4),
  vigencia      text,
  vig_inicio    date,
  vig_fim       date
);
create index tabela_especial_artigo on cadastro.tabela_especial (artigo);

-- ─────────────────────────────────────────────────────────────────────
-- Carimbo de atualização e auditoria
-- ─────────────────────────────────────────────────────────────────────
create trigger perfis_carimbo   before update on cadastro.perfis   for each row execute function sistema.carimbar_atualizacao();
create trigger clientes_carimbo before update on cadastro.clientes for each row execute function sistema.carimbar_atualizacao();
create trigger produtos_carimbo before update on cadastro.produtos for each row execute function sistema.carimbar_atualizacao();

create trigger perfis_auditoria   after insert or update or delete on cadastro.perfis   for each row execute function sistema.auditar('codigo');
create trigger clientes_auditoria after insert or update or delete on cadastro.clientes for each row execute function sistema.auditar('codigo');
create trigger produtos_auditoria after insert or update or delete on cadastro.produtos for each row execute function sistema.auditar('artigo');
create trigger tabela_especial_auditoria after insert or update or delete on cadastro.tabela_especial for each row execute function sistema.auditar('artigo');

-- ─────────────────────────────────────────────────────────────────────
-- RLS: tudo trancado; as políticas abrem só o necessário
-- ─────────────────────────────────────────────────────────────────────
alter table sistema.auditoria          enable row level security;
alter table sistema.publicacoes        enable row level security;
alter table sistema.status_app         enable row level security;
alter table cadastro.perfis            enable row level security;
alter table cadastro.clientes          enable row level security;
alter table cadastro.clientes_prepostos enable row level security;
alter table cadastro.produtos          enable row level security;
alter table cadastro.fichas            enable row level security;
alter table cadastro.tabela_especial   enable row level security;

-- Sistema
create policy auditoria_ver on sistema.auditoria for select to authenticated using (sistema.sou_admin());
create policy publicacoes_ver on sistema.publicacoes for select to authenticated using (true);
create policy publicacoes_admin on sistema.publicacoes for insert to authenticated with check (sistema.sou_admin());
create policy status_ver on sistema.status_app for select to anon, authenticated
  using (not em_desenvolvimento or sistema.sou_dev());
create policy status_admin on sistema.status_app for all to authenticated using (sistema.sou_admin()) with check (sistema.sou_admin());

-- Perfis: cada um vê o seu; quem vê tudo vê todos; só admin altera
create policy perfis_ver on cadastro.perfis for select to authenticated
  using (user_id = auth.uid() or sistema.vejo_tudo());
create policy perfis_admin on cadastro.perfis for all to authenticated
  using (sistema.sou_admin()) with check (sistema.sou_admin());

-- Clientes: o vendedor vê e edita os da sua lista
create policy clientes_ver on cadastro.clientes for select to authenticated
  using (sistema.vejo_tudo() or exists (
    select 1 from cadastro.clientes_prepostos cp
    where cp.cliente = codigo and cp.preposto = sistema.meu_codigo()));
create policy clientes_editar on cadastro.clientes for update to authenticated
  using (sistema.sou_admin() or exists (
    select 1 from cadastro.clientes_prepostos cp
    where cp.cliente = codigo and cp.preposto = sistema.meu_codigo()))
  with check (sistema.sou_admin() or exists (
    select 1 from cadastro.clientes_prepostos cp
    where cp.cliente = codigo and cp.preposto = sistema.meu_codigo()));
create policy clientes_admin on cadastro.clientes for all to authenticated
  using (sistema.sou_admin()) with check (sistema.sou_admin());

create policy vinculo_ver on cadastro.clientes_prepostos for select to authenticated
  using (sistema.vejo_tudo() or preposto = sistema.meu_codigo());
create policy vinculo_admin on cadastro.clientes_prepostos for all to authenticated
  using (sistema.sou_admin()) with check (sistema.sou_admin());

-- Produtos, fichas e tabela especial: quem tem login lê; só admin altera
create policy produtos_ver on cadastro.produtos for select to authenticated using (true);
create policy produtos_admin on cadastro.produtos for all to authenticated
  using (sistema.sou_admin()) with check (sistema.sou_admin());
create policy fichas_ver on cadastro.fichas for select to authenticated using (true);
create policy fichas_admin on cadastro.fichas for all to authenticated
  using (sistema.sou_admin()) with check (sistema.sou_admin());
create policy tabela_especial_ver on cadastro.tabela_especial for select to authenticated using (true);
create policy tabela_especial_admin on cadastro.tabela_especial for all to authenticated
  using (sistema.sou_admin()) with check (sistema.sou_admin());

-- Permissões de uso dos schemas (as políticas acima decidem as linhas)
grant usage on schema sistema, cadastro to authenticated;
grant usage on schema sistema to anon;
grant select on sistema.status_app to anon;
grant select, insert, update, delete on all tables in schema cadastro to authenticated;
grant select on sistema.auditoria, sistema.publicacoes, sistema.status_app to authenticated;
grant insert on sistema.publicacoes to authenticated;
grant insert, update, delete on sistema.status_app to authenticated;
grant execute on function sistema.meu_codigo(), sistema.meu_papel(), sistema.vejo_tudo(), sistema.sou_admin(), sistema.sou_dev() to authenticated;
grant execute on function sistema.sou_dev() to anon;
