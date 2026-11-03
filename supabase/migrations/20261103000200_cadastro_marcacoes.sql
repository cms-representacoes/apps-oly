-- Portal CMS · migração 2: marcações por artigo/cor
--
-- Exclusivos, novidades e faixas valem também para artigos que não estão
-- em cadastro.produtos (UA, disponibilidades, Detalhada). Por isso saem da
-- tabela de produtos e ganham tabelas próprias, sem chave estrangeira.

alter table cadastro.produtos
  drop column canal_exclusivo,
  drop column novidade_em,
  drop column faixa;

create table cadastro.exclusivos (
  artigo  text not null,
  cor     text not null,
  canal   text not null check (canal in ('DTC', 'ML', 'DTC+ML')),
  primary key (artigo, cor)
);
comment on table cadastro.exclusivos is 'Produto de canal exclusivo (DTC / Mercado Livre): não entra na vitrine.';

create table cadastro.novidades (
  artigo  text not null,
  cor     text not null,
  desde   date not null,
  primary key (artigo, cor)
);
comment on table cadastro.novidades is 'Quando o artigo/cor apareceu pela primeira vez: alimenta o selo Novo.';

create table cadastro.faixas (
  artigo  text primary key,
  faixa   text not null
);
comment on table cadastro.faixas is 'Faixa comercial do artigo (CORRIDA/TREINO, CHINELOS, TENIS UA...), vinda da Detalhada.';

create trigger exclusivos_auditoria after insert or update or delete on cadastro.exclusivos for each row execute function sistema.auditar('artigo');

alter table cadastro.exclusivos enable row level security;
alter table cadastro.novidades  enable row level security;
alter table cadastro.faixas     enable row level security;

create policy exclusivos_ver on cadastro.exclusivos for select to authenticated using (true);
create policy exclusivos_admin on cadastro.exclusivos for all to authenticated
  using (sistema.sou_admin()) with check (sistema.sou_admin());
create policy novidades_ver on cadastro.novidades for select to authenticated using (true);
create policy novidades_admin on cadastro.novidades for all to authenticated
  using (sistema.sou_admin()) with check (sistema.sou_admin());
create policy faixas_ver on cadastro.faixas for select to authenticated using (true);
create policy faixas_admin on cadastro.faixas for all to authenticated
  using (sistema.sou_admin()) with check (sistema.sou_admin());

grant select, insert, update, delete on cadastro.exclusivos, cadastro.novidades, cadastro.faixas to authenticated;
