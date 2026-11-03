-- Portal CMS · migração 3: as demais áreas do portal
--
-- repasse    pedidos do Repasse/CMS PASS, campanhas, rateio, links da vitrine, sacolas, desejos
-- fabrica    DISPO, cancelamentos, disponibilidades, grades CORRE/GERAL
-- carteira   Detalhada (linha a linha), movimento, Carteira CMS, ações, faturados, cortes de giro
-- catalogo   pedidos e rascunhos do Catálogo Digital
-- matriz     Matriz Esportes (lojas, itens, pendências)
-- relatorios Carta Campanha, Metas (RFV e Performance vão como arquivo no Storage)
-- sistema.documentos  JSONs de configuração/painel que não pedem tabela própria
--
-- Regra de acesso: vendedor vê só o que é dele; CMS e DEV veem e alteram tudo.
-- Campos que o app grava e não têm coluna própria ficam em `extra`, para
-- nada se perder na cópia.

create schema if not exists repasse;
create schema if not exists fabrica;
create schema if not exists carteira;
create schema if not exists catalogo;
create schema if not exists matriz;
create schema if not exists relatorios;

-- O cliente é de quem? (vínculo do cadastro)
create or replace function sistema.cliente_e_meu(p_cliente text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from cadastro.clientes_prepostos
                 where cliente = p_cliente and preposto = sistema.meu_codigo())
$$;
grant execute on function sistema.cliente_e_meu(text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════
-- REPASSE
-- ═════════════════════════════════════════════════════════════════════
create table repasse.pedidos (
  id              text primary key,
  criado_em       timestamptz not null,
  atualizado_em   timestamptz,
  status          text not null,                 -- Pendente / Aprovado / Cancelado
  arquivado       boolean not null default false,
  duplicado       boolean not null default false,
  preposto        text not null,
  preposto_nome   text,
  cliente         text,
  cliente_nome    text,
  prazo           text,
  campanha        text,
  observacoes     text,
  total_caixas    integer,
  total_pares     integer,
  exportado_em    timestamptz,
  ultima_acao     text,
  ultima_acao_rotulo text,
  ultima_acao_em  timestamptz,
  extra           jsonb not null default '{}'
);
create index pedidos_preposto on repasse.pedidos (preposto, criado_em desc);
create index pedidos_status on repasse.pedidos (status);

create table repasse.pedido_itens (
  id              bigint generated always as identity primary key,
  pedido_id       text not null references repasse.pedidos (id) on delete cascade,
  ordem           integer not null,
  artigo          text,
  descricao       text,
  cor             text,
  lote            text,                          -- num da DISPO
  gci             text,
  ebm             text,
  quantidade      integer,
  modo            text,                          -- boxed / avulso
  por_caixa       integer,
  pares           integer,
  grade           jsonb,
  prev_faturamento text,
  extra           jsonb not null default '{}'
);
create index pedido_itens_pedido on repasse.pedido_itens (pedido_id);
create index pedido_itens_gci on repasse.pedido_itens (gci);

create table repasse.pedido_eventos (
  id              bigint generated always as identity primary key,
  pedido_id       text not null references repasse.pedidos (id) on delete cascade,
  evento_id       text,
  em              timestamptz,
  acao            text,
  rotulo          text,
  status_de       text,
  status_para     text,
  arquivado_de    boolean,
  arquivado_para  boolean,
  preposto        text,
  notas           text,
  meta            jsonb,
  extra           jsonb not null default '{}'
);
create index pedido_eventos_pedido on repasse.pedido_eventos (pedido_id, em);

create table repasse.campanhas (
  id              text primary key,
  nome            text not null,
  valor           numeric(12, 2),
  inicio          date,
  fim             date,
  produtos        text[] not null default '{}',
  cores           text[] not null default '{}',
  vendedores      text[] not null default '{}',
  conta           text,
  teto            numeric(12, 2),
  mostrar_valor   boolean,
  mostrar_posicao boolean,
  pausada         boolean not null default false,
  criada_em       timestamptz,
  extra           jsonb not null default '{}'
);

-- Rateio de um lote da DISPO entre os vendedores
create table repasse.rateio (
  lote      text primary key,
  selo      text,
  divisao   jsonb not null                       -- { "114611": 48, ... }
);

-- Lotes escondidos da vitrine: artigo|cor|gci
create table repasse.lotes_ocultos (
  chave     text primary key
);

-- Links da vitrine que o vendedor manda ao cliente
create table repasse.links_vitrine (
  codigo          text primary key,
  vendedor        text not null,
  vendedor_nome   text,
  cliente         text,
  cliente_nome    text,
  marca           text,
  produtos        jsonb not null,
  criado_em       timestamptz,
  validade_horas  integer,
  expira_em       timestamptz,
  status          text,
  resposta        jsonb,
  respondido_em   timestamptz,
  extra           jsonb not null default '{}'
);
create index links_vitrine_vendedor on repasse.links_vitrine (vendedor);

-- Sacola do cliente (hoje no KV SACOLAS da Cloudflare)
create table repasse.sacolas (
  cliente         text not null,
  marca           text not null,
  itens           jsonb not null,
  atualizado_em   timestamptz not null default now(),
  primary key (cliente, marca)
);

-- Lista de desejos do vendedor (artigo|cor)
create table repasse.desejos (
  preposto  text not null,
  item      text not null,
  primary key (preposto, item)
);

-- Desmembramentos (hoje vazio, mas o Worker grava)
create table repasse.desmembramentos (
  chave     text primary key,
  dados     jsonb not null
);

-- ═════════════════════════════════════════════════════════════════════
-- FÁBRICA
-- ═════════════════════════════════════════════════════════════════════
create table fabrica.dispo (
  lote            text primary key,              -- num
  ebm             text,
  gci             text,
  filial          text,
  artigo          text,
  descricao       text,
  cor             text,
  data_entrega    date,
  pedido_mae      text,
  saldo           integer,
  grade           jsonb,
  extra           jsonb not null default '{}',
  atualizado_em   timestamptz not null default now()
);
create index dispo_artigo on fabrica.dispo (artigo, cor);

create table fabrica.dispo_cancelamentos (
  id              text primary key,
  lote            text,
  gci             text,
  artigo          text,
  descricao       text,
  cor             text,
  filial          text,
  data_entrega    date,
  caixas          integer,
  por_caixa       integer,
  pares           integer,
  saldo_antes     integer,
  saldo_depois    integer,
  total           boolean,
  motivo          text,
  obs             text,
  por             text,
  em              timestamptz,
  extra           jsonb not null default '{}'
);

create table fabrica.disponibilidades (
  id              bigint generated always as identity primary key,
  marca           text,
  prev_fat        text,                          -- "NOVEMBRO 2026"
  empresa         text,
  artigo          text,
  descricao       text,
  cor             text,
  linha           text,
  genero          text,
  categoria       text,
  categoria_original text,
  categoria_produto  text,
  pdv             numeric(12, 2),
  total           integer,
  codigo_tabela   text,
  mkp             text,
  custo           text,
  imagem          text,
  grade           jsonb,
  quinzenas       jsonb,
  tabelas_especiais jsonb,
  extra           jsonb not null default '{}'
);
create index disponibilidades_artigo on fabrica.disponibilidades (artigo, cor);

create table fabrica.disponibilidades_ocultos (
  chave     text primary key
);

create table fabrica.imagens (
  chave     text primary key,                    -- artigo|cor
  imagem    text not null
);

-- Atributos dos produtos das disponibilidades (dados_produtos.json)
create table fabrica.produtos_disponibilidade (
  chave     text primary key,                    -- artigo|cor
  nome      text,
  categoria text,
  genero    text,
  pdv       numeric(12, 2)
);

-- Grades da carteira (CORRE e GERAL): a planilha inteira, linha a linha
create table fabrica.grade_carteira (
  familia   text not null check (familia in ('corre', 'geral')),
  aba       text not null,                       -- OLY FTW EM ABERTO, UA CHI EM ABERTO...
  linha     integer not null,
  dados     jsonb not null,                      -- { "Marca": "OLY", "Artigo": ..., "35": 2, ... }
  primary key (familia, aba, linha)
);

-- ═════════════════════════════════════════════════════════════════════
-- CARTEIRA
-- ═════════════════════════════════════════════════════════════════════
create table carteira.detalhada (
  id              bigint generated always as identity primary key,
  preposto        text,                          -- código do perfil
  preposto_nome   text,
  cliente         text,
  cliente_nome    text,
  marca           text,
  fabrica         text,
  filial          text,
  referencia      text,
  descricao       text,
  cor             text,
  gci             text,
  nf              text,
  oc              text,
  prev_fat        date,
  cart            integer not null default 0,
  fat             integer not null default 0,
  data_fat        date,
  faixa           text,
  cod_comercial   text,
  cod_financeiro  text
);
create index detalhada_preposto on carteira.detalhada (preposto);
create index detalhada_cliente on carteira.detalhada (cliente);
create index detalhada_ref on carteira.detalhada (referencia, cor);
create index detalhada_gci on carteira.detalhada (gci);
comment on table carteira.detalhada is 'Detalhada por preposto: substituída inteira a cada publicação do script diário.';

-- Entradas e saídas do mês (movimento)
create table carteira.movimento (
  id              bigint generated always as identity primary key,
  dia             date not null,
  tipo            text not null,                 -- e = entrada, s = saída
  gci             text,
  referencia      text,
  descricao       text,
  cor             text,
  cliente         text,
  cliente_nome    text,
  preposto        text,
  preposto_nome   text,
  marca           text,
  faixa           text,
  prev_fat        date,
  quantidade      integer,
  motivo          text,
  fat_antes       integer
);
create index movimento_dia on carteira.movimento (dia);
create index movimento_preposto on carteira.movimento (preposto);

-- Primeira previsão de cada encomenda (prev0): cli|gci|ref|cor
create table carteira.primeira_previsao (
  chave     text primary key,
  cliente   text,
  prev_fat  date not null
);

-- Carteira CMS importada (planilha do vendedor)
create table carteira.carteira_cms (
  id              bigint generated always as identity primary key,
  cliente         text,
  preposto        text,
  preposto_nome   text,
  marca           text,
  tipo            text,
  artigo          text,
  descricao       text,
  cor             text,
  gci             text,
  ebm             text,
  grade           jsonb,
  total           integer,
  preco_unit      numeric(12, 2),
  total_preco     numeric(14, 2),
  prev_fat        text,
  acao            text,
  dados           jsonb not null                 -- a linha inteira, como veio
);
create index carteira_cms_cliente on carteira.carteira_cms (cliente);

create table carteira.acoes (
  chave     text primary key,                    -- cliente|gci|artigo|cor|grade|qtd
  cliente   text,
  acao      text,
  repasse   jsonb,
  por       text,
  atualizado_em timestamptz
);
create index acoes_cliente on carteira.acoes (cliente);

create table carteira.faturados (
  cliente   text not null,
  artigo    text not null,
  descricao text,
  cor       text not null,
  pares     integer not null,
  primary key (cliente, artigo, cor)
);

-- Análise de Giro: o que o cliente marcou para cancelar
create table carteira.giro_cortes (
  cliente   text primary key,
  itens     jsonb not null,
  atualizado_em timestamptz,
  por       text
);

-- ═════════════════════════════════════════════════════════════════════
-- CATÁLOGO DIGITAL
-- ═════════════════════════════════════════════════════════════════════
create table catalogo.pedidos (
  id              text primary key,
  criado_em       timestamptz,
  preposto        text not null,                 -- comissionista
  preposto_nome   text,
  cliente         text,
  pagamento       text,
  tabela_preco    text,
  campanha        text,
  data_desejada   text,
  pedido_cliente  text,
  total_itens     integer,
  valor_total     numeric(14, 2),
  origem          text not null default 'catalogo',  -- catalogo / vitrine
  extra           jsonb not null default '{}'
);
create index catalogo_pedidos_preposto on catalogo.pedidos (preposto, criado_em desc);

create table catalogo.pedido_itens (
  id              bigint generated always as identity primary key,
  pedido_id       text not null references catalogo.pedidos (id) on delete cascade,
  ordem           integer not null,
  artigo          text,
  descricao       text,
  cor             text,
  quantidade      integer,
  preco           numeric(12, 2),
  dados           jsonb not null                 -- o item inteiro (grade, preços por prazo...)
);
create index catalogo_pedido_itens_pedido on catalogo.pedido_itens (pedido_id);

create table catalogo.rascunhos (
  id              text primary key,
  preposto        text not null,
  dados           jsonb not null,
  atualizado_em   timestamptz not null default now()
);
create index catalogo_rascunhos_preposto on catalogo.rascunhos (preposto);

-- ═════════════════════════════════════════════════════════════════════
-- MATRIZ ESPORTES
-- ═════════════════════════════════════════════════════════════════════
create table matriz.lojas (
  codigo          text primary key,
  nome            text,
  cidade          text,
  token           text unique not null,          -- link de acesso da loja
  ultima_atualizacao timestamptz,
  extra           jsonb not null default '{}'
);

create table matriz.itens (
  loja            text not null references matriz.lojas (codigo) on delete cascade,
  marca           text not null,                 -- OLY FTW / OLY CHI / UA FTW
  item_id         text not null,                 -- artigo|cor
  artigo          text,
  descricao       text,
  cor             text,
  preposto        text,
  estoque         integer,
  venda           integer,
  atualizado_em   timestamptz,
  extra           jsonb not null default '{}',
  primary key (loja, marca, item_id)
);

create table matriz.pendentes (
  id              text primary key,
  tipo            text,
  loja            text,
  loja_nome       text,
  marca           text,
  item_id         text,
  artigo          text,
  descricao       text,
  cor             text,
  status          text,
  criado_em       timestamptz,
  resolvido_em    timestamptz,
  extra           jsonb not null default '{}'
);

-- ═════════════════════════════════════════════════════════════════════
-- RELATÓRIOS
-- ═════════════════════════════════════════════════════════════════════
create table relatorios.carta (
  preposto  text not null,
  marca     text not null,
  mes       text not null,                       -- 2026-01
  dados     jsonb not null,
  primary key (preposto, marca, mes)
);

create table relatorios.metas (
  mes       text primary key,
  dados     jsonb not null
);

-- Planilhas (RFV, Performance) guardadas no Storage: aqui fica o índice
create table relatorios.arquivos (
  relatorio text not null,                       -- rfv / performance
  chave     text not null,                       -- Tênis / 2026-S1 ...
  nome      text,
  caminho   text not null,                       -- bucket relatorios
  atualizado_em timestamptz,
  extra     jsonb not null default '{}',
  primary key (relatorio, chave)
);

-- ═════════════════════════════════════════════════════════════════════
-- SISTEMA: documentos JSON (painel da TV, GTM, circular, fichas Oly...)
-- ═════════════════════════════════════════════════════════════════════
create table sistema.documentos (
  chave         text primary key,                -- ex.: painel-tv/tv_data
  app           text not null,
  dados         jsonb not null,
  origem        text,
  atualizado_em timestamptz not null default now()
);

-- Índice dos arquivos antigos guardados no Storage (backups)
create table sistema.arquivo_historico (
  caminho       text primary key,                -- bucket arquivo
  tipo          text not null,                   -- dispo / pedidos / produtos / catalogo-historico
  data          date,
  bytes_original bigint,
  bytes_gzip    bigint
);

-- ═════════════════════════════════════════════════════════════════════
-- Auditoria nas tabelas em que pessoas gravam
-- ═════════════════════════════════════════════════════════════════════
create trigger t_aud after insert or update or delete on repasse.pedidos            for each row execute function sistema.auditar('id');
create trigger t_aud after insert or update or delete on repasse.pedido_itens       for each row execute function sistema.auditar('pedido_id');
create trigger t_aud after insert or update or delete on repasse.campanhas          for each row execute function sistema.auditar('id');
create trigger t_aud after insert or update or delete on repasse.rateio             for each row execute function sistema.auditar('lote');
create trigger t_aud after insert or update or delete on repasse.links_vitrine      for each row execute function sistema.auditar('codigo');
create trigger t_aud after insert or update or delete on fabrica.dispo               for each row execute function sistema.auditar('lote');
create trigger t_aud after insert or update or delete on fabrica.dispo_cancelamentos for each row execute function sistema.auditar('id');
create trigger t_aud after insert or update or delete on carteira.acoes             for each row execute function sistema.auditar('chave');
create trigger t_aud after insert or update or delete on carteira.giro_cortes       for each row execute function sistema.auditar('cliente');
create trigger t_aud after insert or update or delete on catalogo.pedidos           for each row execute function sistema.auditar('id');
create trigger t_aud after insert or update or delete on matriz.pendentes           for each row execute function sistema.auditar('id');
create trigger t_aud after insert or update or delete on matriz.itens               for each row execute function sistema.auditar('item_id');
create trigger t_carimbo before update on fabrica.dispo for each row execute function sistema.carimbar_atualizacao();

-- ═════════════════════════════════════════════════════════════════════
-- RLS
-- ═════════════════════════════════════════════════════════════════════
do $$
declare t record;
begin
  for t in select schemaname, tablename from pg_tables
           where schemaname in ('repasse', 'fabrica', 'carteira', 'catalogo', 'matriz', 'relatorios')
              or (schemaname = 'sistema' and tablename in ('documentos', 'arquivo_historico'))
  loop
    execute format('alter table %I.%I enable row level security', t.schemaname, t.tablename);
    -- CMS e DEV: tudo, em todas
    execute format('create policy admin_tudo on %I.%I for all to authenticated using (sistema.sou_admin()) with check (sistema.sou_admin())',
                   t.schemaname, t.tablename);
  end loop;
end $$;

-- Leitura para quem tem login: dados da fábrica e de produto, que todo vendedor consulta
create policy ler on fabrica.dispo                   for select to authenticated using (true);
create policy ler on fabrica.disponibilidades        for select to authenticated using (true);
create policy ler on fabrica.disponibilidades_ocultos for select to authenticated using (true);
create policy ler on fabrica.imagens                 for select to authenticated using (true);
create policy ler on fabrica.produtos_disponibilidade for select to authenticated using (true);
create policy ler on fabrica.grade_carteira          for select to authenticated using (true);
create policy ler on fabrica.dispo_cancelamentos     for select to authenticated using (true);
create policy ler on repasse.campanhas               for select to authenticated using (true);
create policy ler on repasse.rateio                  for select to authenticated using (true);
create policy ler on repasse.lotes_ocultos           for select to authenticated using (true);
create policy ler on relatorios.arquivos             for select to authenticated using (true);
create policy ler on sistema.documentos              for select to authenticated using (true);

-- Do vendedor: o que tem o código dele
create policy meu on repasse.pedidos for all to authenticated
  using (preposto = sistema.meu_codigo()) with check (preposto = sistema.meu_codigo());
create policy meu on repasse.pedido_itens for all to authenticated
  using (exists (select 1 from repasse.pedidos p where p.id = pedido_id and p.preposto = sistema.meu_codigo()))
  with check (exists (select 1 from repasse.pedidos p where p.id = pedido_id and p.preposto = sistema.meu_codigo()));
create policy meu on repasse.pedido_eventos for all to authenticated
  using (exists (select 1 from repasse.pedidos p where p.id = pedido_id and p.preposto = sistema.meu_codigo()))
  with check (exists (select 1 from repasse.pedidos p where p.id = pedido_id and p.preposto = sistema.meu_codigo()));
create policy meu on repasse.links_vitrine for all to authenticated
  using (vendedor = sistema.meu_codigo()) with check (vendedor = sistema.meu_codigo());
create policy meu on repasse.desejos for all to authenticated
  using (preposto = sistema.meu_codigo()) with check (preposto = sistema.meu_codigo());
create policy meu on repasse.sacolas for all to authenticated
  using (sistema.cliente_e_meu(cliente)) with check (sistema.cliente_e_meu(cliente));
create policy meu on carteira.detalhada for select to authenticated
  using (preposto = sistema.meu_codigo());
create policy meu on carteira.movimento for select to authenticated
  using (preposto = sistema.meu_codigo());
create policy meu on carteira.primeira_previsao for select to authenticated
  using (sistema.cliente_e_meu(cliente));
create policy meu on carteira.carteira_cms for all to authenticated
  using (preposto = sistema.meu_codigo()) with check (preposto = sistema.meu_codigo());
create policy meu on carteira.acoes for all to authenticated
  using (sistema.cliente_e_meu(cliente)) with check (sistema.cliente_e_meu(cliente));
create policy meu on carteira.faturados for select to authenticated
  using (sistema.cliente_e_meu(cliente));
create policy meu on catalogo.pedidos for all to authenticated
  using (preposto = sistema.meu_codigo()) with check (preposto = sistema.meu_codigo());
create policy meu on catalogo.pedido_itens for all to authenticated
  using (exists (select 1 from catalogo.pedidos p where p.id = pedido_id and p.preposto = sistema.meu_codigo()))
  with check (exists (select 1 from catalogo.pedidos p where p.id = pedido_id and p.preposto = sistema.meu_codigo()));
create policy meu on catalogo.rascunhos for all to authenticated
  using (preposto = sistema.meu_codigo()) with check (preposto = sistema.meu_codigo());
create policy meu on relatorios.carta for select to authenticated
  using (preposto = sistema.meu_codigo());
-- Matriz, giro_cortes, metas, movimento de fábrica: só CMS/DEV por enquanto.
-- O acesso da loja (token) e do cliente (link) vai por funções próprias, depois.

grant usage on schema repasse, fabrica, carteira, catalogo, matriz, relatorios to authenticated;
grant select, insert, update, delete on all tables in schema repasse, fabrica, carteira, catalogo, matriz, relatorios to authenticated;
grant select, insert, update, delete on sistema.documentos, sistema.arquivo_historico to authenticated;
