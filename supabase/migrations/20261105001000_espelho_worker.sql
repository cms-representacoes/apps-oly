-- Portal CMS · migração 10: o Worker grava nos dois lugares
--
-- Depois de gravar um arquivo no GitHub, o Worker manda o mesmo conteúdo
-- para sistema.receber_arquivo(caminho, conteudo). A função guarda o
-- arquivo como veio (sistema.arquivos_vivos) e o distribui nas tabelas na
-- hora — o banco fica em dia sem esperar a cópia da noite, que continua
-- como rede de segurança (recarrega tudo e confere).
--
-- caminho = "<repositório>/<caminho no repositório>", ex.: apps-oly/data/pedidos.json
--           "kv/<chave>" para o que o Worker guarda no KV da Cloudflare
--
-- Só a chave secreta (service_role) chama: as telas nunca.

create table if not exists sistema.arquivos_vivos (
  caminho      text primary key,
  conteudo     jsonb not null,
  recebido_em  timestamptz not null default now(),
  aplicado     boolean not null default false,
  erro         text
);
alter table sistema.arquivos_vivos enable row level security;
drop policy if exists admin_tudo on sistema.arquivos_vivos;
create policy admin_tudo on sistema.arquivos_vivos for all to authenticated
  using (sistema.sou_admin()) with check (sistema.sou_admin());

-- Mix do GTM (KV gtmmix:<coleção>:<marca>:<código>): a divisão de cores de
-- cada vendedor, por coleção e marca
drop table if exists repasse.mix_gtm;
create table repasse.mix_gtm (
  colecao      text not null,
  marca        text not null,
  preposto     text not null,
  dados        jsonb not null,
  atualizado_em timestamptz not null default now(),
  primary key (colecao, marca, preposto)
);
alter table repasse.mix_gtm enable row level security;
drop policy if exists admin_tudo on repasse.mix_gtm;
create policy admin_tudo on repasse.mix_gtm for all to authenticated
  using (sistema.sou_admin()) with check (sistema.sou_admin());
drop policy if exists meu on repasse.mix_gtm;
create policy meu on repasse.mix_gtm for all to authenticated
  using (preposto = sistema.meu_codigo()) with check (preposto = sistema.meu_codigo());
grant select, insert, update, delete on repasse.mix_gtm to authenticated;

-- A auditoria pula o que vem do Worker: o aviso cms.sem_auditoria vale só
-- dentro da transação de receber_arquivo
create or replace function sistema.auditar() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  linha jsonb := to_jsonb(coalesce(new, old));
begin
  if current_setting('cms.sem_auditoria', true) = '1' then
    return coalesce(new, old);
  end if;
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

-- ── utilitários ───────────────────────────────────────────────────────
create or replace function sistema.txt(v jsonb) returns text
language sql immutable as $$
  select nullif(trim(case jsonb_typeof(v) when 'string' then v #>> '{}' when 'null' then null else v::text end), '')
$$;

create or replace function sistema.data_br(v text) returns date
language sql immutable as $$
  select case when v ~ '^\d{2}/\d{2}/\d{4}$' then to_date(v, 'DD/MM/YYYY') end
$$;

create or replace function sistema.ms(v jsonb) returns timestamptz
language sql immutable as $$
  select case when jsonb_typeof(v) = 'number' then to_timestamp((v #>> '{}')::double precision / 1000)
              when jsonb_typeof(v) = 'string' and v #>> '{}' <> '' then (v #>> '{}')::timestamptz end
$$;

-- o que sobra do objeto, fora as chaves mapeadas
create or replace function sistema.resto(o jsonb, chaves text[]) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(k, v), '{}') from jsonb_each(o) e(k, v) where k <> all(chaves)
$$;

-- nome que aparece nas bases (JORGE, C M S) -> código do perfil
create or replace function sistema.codigo_por_nome(p_nome text) returns text
language sql stable set search_path = '' as $$
  select codigo from cadastro.perfis
   where upper(nome) = upper(trim(p_nome)) or split_part(upper(nome), ' ', 1) = upper(trim(p_nome))
      or (upper(trim(p_nome)) = 'C M S' and codigo = '25846')
   order by (upper(nome) = upper(trim(p_nome))) desc limit 1
$$;

-- ═════════════════════════════════════════════════════════════════════
-- Um aplicador por arquivo. Todos substituem o conteúdo inteiro do que o
-- arquivo representa (o arquivo é sempre a verdade completa). O "where true"
-- é exigido pelo Supabase para apagar a tabela toda pela API: deixa claro
-- que é de propósito.
-- ═════════════════════════════════════════════════════════════════════

create or replace function repasse.aplicar_pedidos(j jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  delete from repasse.pedido_eventos where true; delete from repasse.pedido_itens where true; delete from repasse.pedidos where true;
  insert into repasse.pedidos (id, criado_em, atualizado_em, status, arquivado, duplicado, preposto, preposto_nome,
      cliente, cliente_nome, prazo, campanha, observacoes, total_caixas, total_pares, exportado_em,
      ultima_acao, ultima_acao_rotulo, ultima_acao_em, extra)
  select p->>'id', (p->>'createdAt')::timestamptz, sistema.ms(p->'updatedAt'), p->>'status',
      coalesce((p->>'archived')::boolean, false), coalesce((p->>'isDuplicate')::boolean, false),
      p->'preposto'->>'codigo', p->'preposto'->>'nome', p->>'clienteCodigo', p->>'clienteNome', p->>'prazo',
      p->>'campanha', p->>'observacoes', (p->'totals'->>'packs')::int, (p->'totals'->>'units')::int,
      sistema.ms(p->'exportedAt'), p->>'lastAction', p->>'lastActionLabel', sistema.ms(p->'lastActionAt'),
      sistema.resto(p, array['id','createdAt','updatedAt','status','archived','isDuplicate','clienteCodigo','clienteNome',
        'prazo','campanha','observacoes','exportedAt','lastAction','lastActionLabel','lastActionAt','preposto','totals','items','history'])
  from jsonb_array_elements(j) p;
  insert into repasse.pedido_itens (pedido_id, ordem, artigo, descricao, cor, lote, gci, ebm, quantidade, modo,
      por_caixa, pares, grade, prev_faturamento, extra)
  select p->>'id', (o - 1)::int, i->>'codigo', i->>'produto', i->>'cor', i->>'num', i->>'gci', i->>'ebm',
      (i->>'amount')::int, i->>'mode', (i->>'packSize')::int, (i->>'totalUnits')::int, i->'grade', i->>'prevFaturamento',
      sistema.resto(i, array['codigo','produto','cor','num','gci','ebm','amount','mode','packSize','totalUnits','grade','prevFaturamento'])
  from jsonb_array_elements(j) p, jsonb_array_elements(coalesce(p->'items', '[]')) with ordinality x(i, o);
  insert into repasse.pedido_eventos (pedido_id, evento_id, em, acao, rotulo, status_de, status_para, arquivado_de,
      arquivado_para, preposto, notas, meta, extra)
  select p->>'id', h->>'eventId', sistema.ms(h->'at'), h->>'action', h->>'label', h->>'statusFrom', h->>'statusTo',
      (h->>'archivedFrom')::boolean, (h->>'archivedTo')::boolean, h->>'prepostoCodigo', h->>'notes', h->'meta',
      sistema.resto(h, array['eventId','at','action','label','statusFrom','statusTo','archivedFrom','archivedTo','prepostoCodigo','notes','meta'])
  from jsonb_array_elements(j) p, jsonb_array_elements(coalesce(p->'history', '[]')) h;
end $$;

create or replace function repasse.aplicar_campanhas(j jsonb) returns void
language sql set search_path = '' as $$
  delete from repasse.campanhas where true;
  insert into repasse.campanhas (id, nome, valor, inicio, fim, produtos, cores, vendedores, conta, teto,
      mostrar_valor, mostrar_posicao, pausada, criada_em, extra)
  select c->>'id', c->>'nome', (c->>'valor')::numeric, (c->>'inicio')::date, (c->>'fim')::date,
      array(select jsonb_array_elements_text(coalesce(c->'produtos', '[]'))),
      array(select jsonb_array_elements_text(coalesce(c->'cores', '[]'))),
      array(select jsonb_array_elements_text(coalesce(c->'vendedores', '[]'))),
      c->>'conta', (c->>'teto')::numeric, (c->>'mostrarValor')::boolean, (c->>'mostrarPosicao')::boolean,
      coalesce((c->>'pausada')::boolean, false), (c->>'criadaEm')::timestamptz,
      sistema.resto(c, array['id','nome','valor','inicio','fim','produtos','cores','vendedores','conta','teto','mostrarValor','mostrarPosicao','pausada','criadaEm'])
  from jsonb_array_elements(j) c;
$$;

create or replace function repasse.aplicar_rateio(j jsonb) returns void
language sql set search_path = '' as $$
  delete from repasse.rateio where true;
  insert into repasse.rateio (lote, selo, divisao)
  select k, v->>'_selo', v - '_selo' from jsonb_each(j) e(k, v);
$$;

create or replace function repasse.aplicar_ocultos(j jsonb) returns void
language sql set search_path = '' as $$
  delete from repasse.lotes_ocultos where true;
  insert into repasse.lotes_ocultos (chave) select distinct x from jsonb_array_elements_text(j) x;
$$;

create or replace function repasse.aplicar_desmembramentos(j jsonb) returns void
language sql set search_path = '' as $$
  delete from repasse.desmembramentos where true;
  insert into repasse.desmembramentos (chave, dados) select k, v from jsonb_each(j) e(k, v);
$$;

create or replace function repasse.aplicar_links(j jsonb) returns void
language sql set search_path = '' as $$
  delete from repasse.links_vitrine where true;
  insert into repasse.links_vitrine (codigo, vendedor, vendedor_nome, cliente, cliente_nome, marca, produtos,
      criado_em, validade_horas, expira_em, status, resposta, respondido_em, extra)
  select k, l->>'vendedor', l->>'vendedorNome', l->>'cliente', l->>'clienteNome', l->>'marca', coalesce(l->'produtos', '[]'),
      sistema.ms(l->'criadoEm'), (l->>'validadeHoras')::int, sistema.ms(l->'expiraEm'), l->>'status', l->'resposta',
      sistema.ms(l->'respondidoEm'),
      sistema.resto(l, array['vendedor','vendedorNome','cliente','clienteNome','marca','produtos','criadoEm','validadeHoras','expiraEm','status','resposta','respondidoEm'])
  from jsonb_each(j) e(k, l);
$$;

create or replace function repasse.aplicar_desejos(p_preposto text, j jsonb) returns void
language sql set search_path = '' as $$
  delete from repasse.desejos where preposto = p_preposto;
  insert into repasse.desejos (preposto, item) select distinct p_preposto, x from jsonb_array_elements_text(j) x;
$$;

-- KV sacola:<cliente>:<marca> -> { itens, em, de }
create or replace function repasse.aplicar_sacola(p_chave text, j jsonb) returns void
language sql set search_path = '' as $$
  insert into repasse.sacolas (cliente, marca, itens, atualizado_em)
  values (split_part(p_chave, ':', 2), split_part(p_chave, ':', 3), coalesce(j->'itens', '[]'),
          coalesce((j->>'em')::timestamptz, now()))
  on conflict (cliente, marca) do update set itens = excluded.itens, atualizado_em = excluded.atualizado_em;
$$;

create or replace function fabrica.aplicar_dispo(j jsonb) returns void
language sql set search_path = '' as $$
  delete from fabrica.dispo where true;
  insert into fabrica.dispo (lote, ebm, gci, filial, artigo, descricao, cor, data_entrega, pedido_mae, saldo, grade, extra)
  select d->>'num', d->>'ebm', d->>'gci', d->>'filial', d->>'codigo', d->>'produto', d->>'cor',
      sistema.data_br(d->>'dataEntrega'), d->>'pedidoMae', (d->>'saldo')::int, d->'grade',
      sistema.resto(d, array['num','ebm','gci','filial','codigo','produto','cor','dataEntrega','pedidoMae','saldo','grade'])
  from jsonb_array_elements(j) d;
$$;

create or replace function fabrica.aplicar_cancelamentos(j jsonb) returns void
language sql set search_path = '' as $$
  delete from fabrica.dispo_cancelamentos where true;
  insert into fabrica.dispo_cancelamentos (id, lote, gci, artigo, descricao, cor, filial, data_entrega, caixas, por_caixa,
      pares, saldo_antes, saldo_depois, total, motivo, obs, por, em, extra)
  select c->>'id', c->>'num', c->>'gci', c->>'codigo', c->>'produto', c->>'cor', c->>'filial', sistema.data_br(c->>'dataEntrega'),
      (c->>'caixas')::int, (c->>'porCaixa')::int, (c->>'pares')::int, (c->>'saldoAntes')::int, (c->>'saldoDepois')::int,
      (c->>'total')::boolean, c->>'motivo', c->>'obs', c->>'por', (c->>'em')::timestamptz,
      sistema.resto(c, array['id','num','gci','codigo','produto','cor','filial','dataEntrega','caixas','porCaixa','pares','saldoAntes','saldoDepois','total','motivo','obs','por','em'])
  from jsonb_array_elements(j) c;
$$;

create or replace function fabrica.aplicar_disponibilidades(j jsonb) returns void
language sql set search_path = '' as $$
  delete from fabrica.disponibilidades where true;
  insert into fabrica.disponibilidades (marca, prev_fat, empresa, artigo, descricao, cor, linha, genero, categoria,
      categoria_original, categoria_produto, pdv, total, codigo_tabela, mkp, custo, imagem, grade, quinzenas,
      tabelas_especiais, extra)
  select d->>'marca', d->>'prevFat', d->>'empresa', d->>'artigo', d->>'descricao', d->>'cor', d->>'linha', d->>'genero',
      d->>'categoria', d->>'categoriaOriginal', d->>'categoriaProduto', (d->>'pdv')::numeric, (d->>'totalGeral')::int,
      d->>'codigoTabela', sistema.txt(d->'mkp'), sistema.txt(d->'custo'), d->>'imagem', d->'grade', d->'quinzenas',
      d->'tabelasEspeciais',
      sistema.resto(d, array['marca','prevFat','empresa','artigo','descricao','cor','linha','genero','categoria','categoriaOriginal',
        'categoriaProduto','pdv','totalGeral','codigoTabela','mkp','custo','imagem','grade','quinzenas','tabelasEspeciais'])
  from jsonb_array_elements(j) d;
$$;

create or replace function fabrica.aplicar_disp_ocultos(j jsonb) returns void
language sql set search_path = '' as $$
  delete from fabrica.disponibilidades_ocultos where true;
  insert into fabrica.disponibilidades_ocultos (chave)
  select distinct case jsonb_typeof(x) when 'string' then x #>> '{}' else x::text end from jsonb_array_elements(j) x;
$$;

create or replace function fabrica.aplicar_imagens(j jsonb) returns void
language sql set search_path = '' as $$
  delete from fabrica.imagens where true;
  insert into fabrica.imagens (chave, imagem) select k, v #>> '{}' from jsonb_each(j) e(k, v);
$$;

create or replace function cadastro.aplicar_exclusivos(j jsonb) returns void
language sql set search_path = '' as $$
  delete from cadastro.exclusivos where true;
  insert into cadastro.exclusivos (artigo, cor, canal)
  select split_part(k, '|', 1), substr(k, length(split_part(k, '|', 1)) + 2), v #>> '{}' from jsonb_each(j) e(k, v);
$$;

create or replace function cadastro.aplicar_tabela_especial(j jsonb) returns void
language sql set search_path = '' as $$
  delete from cadastro.tabela_especial where true;
  insert into cadastro.tabela_especial (artigo, marca, codigo_tabela, custo, mkp, vigencia, vig_inicio, vig_fim)
  select k, r->>'marca', r->>'codigoTabela', (r->>'custo')::numeric, nullif(r->>'mkp', '')::numeric,
      r->>'vigencia', (r->>'vigInicio')::date, (r->>'vigFim')::date
  from jsonb_each(j) e(k, v), jsonb_array_elements(v) r;
$$;

create or replace function cadastro.aplicar_produtos(j jsonb) returns void
language sql set search_path = '' as $$
  delete from cadastro.produtos where true;
  insert into cadastro.produtos (artigo, cor, marca, descricao, categoria, segmento, genero, tamanhos, pdv, custo, imagem)
  select distinct on (p->>'codigo', p->>'cor')
      p->>'codigo', p->>'cor', p->>'marca', sistema.txt(p->'produto'), sistema.txt(p->'categoria'),
      sistema.txt(p->'segmento'), sistema.txt(p->'genero'), sistema.txt(p->'tam'),
      nullif((p->>'preco')::numeric, 0), nullif((p->>'custo')::numeric, 0), sistema.txt(p->'imagem')
  from jsonb_array_elements(j) p;
$$;

create or replace function cadastro.aplicar_fichas(j jsonb) returns void
language sql set search_path = '' as $$
  delete from cadastro.fichas where true;
  insert into cadastro.fichas (chave, marca, fonte, dados, lido_em)
  select k, sistema.txt(v->'marca'), sistema.txt(v->'fonte'), v, (sistema.txt(v->'lidoEm'))::timestamptz
  from jsonb_each(j) e(k, v);
$$;

-- clientes/<código>.json: a lista daquele vendedor
create or replace function cadastro.aplicar_clientes(p_preposto text, j jsonb) returns void
language sql set search_path = '' as $$
  insert into cadastro.clientes (codigo, razao, cnpj, telefone, cidade, uf, email_nfe, email_bancario, a_vista)
  select distinct on (trim(c->>'codigo')) trim(c->>'codigo'), sistema.txt(c->'nome'), sistema.txt(c->'cnpj'),
      sistema.txt(c->'telefone'), sistema.txt(c->'cidade'), sistema.txt(c->'estado'), sistema.txt(c->'emailNfe'),
      sistema.txt(c->'emailBancario'), upper(left(sistema.txt(c->'avista'), 1)) = 'S'
  from jsonb_array_elements(j) c where trim(coalesce(c->>'codigo', '')) <> ''
  on conflict (codigo) do update set
    razao = coalesce(excluded.razao, cadastro.clientes.razao), cnpj = coalesce(excluded.cnpj, cadastro.clientes.cnpj),
    telefone = coalesce(excluded.telefone, cadastro.clientes.telefone), cidade = coalesce(excluded.cidade, cadastro.clientes.cidade),
    uf = coalesce(excluded.uf, cadastro.clientes.uf), email_nfe = coalesce(excluded.email_nfe, cadastro.clientes.email_nfe),
    email_bancario = coalesce(excluded.email_bancario, cadastro.clientes.email_bancario),
    a_vista = coalesce(excluded.a_vista, cadastro.clientes.a_vista);
  delete from cadastro.clientes_prepostos where preposto = p_preposto;
  insert into cadastro.clientes_prepostos (cliente, preposto)
  select distinct trim(c->>'codigo'), p_preposto from jsonb_array_elements(j) c
   where trim(coalesce(c->>'codigo', '')) <> '' and exists (select 1 from cadastro.perfis where codigo = p_preposto);
$$;

create or replace function carteira.aplicar_carteira_cms(j jsonb) returns void
language sql set search_path = '' as $$
  delete from carteira.carteira_cms where true;
  insert into carteira.carteira_cms (cliente, preposto, preposto_nome, marca, tipo, artigo, descricao, cor, gci, ebm,
      grade, total, preco_unit, total_preco, prev_fat, acao, dados)
  select sistema.txt(p->'cliente_cod'), sistema.codigo_por_nome(p->>'preposto'), p->>'preposto', p->>'marca', p->>'tipo',
      p->>'artigo', p->>'descricao', p->>'cor', sistema.txt(p->'gci'), sistema.txt(p->'ebm'), p->'grade',
      (p->>'total')::int, (p->>'preco_unit')::numeric, (p->>'total_preco')::numeric, p->>'prev_fat', p->>'acao', p
  from jsonb_array_elements(coalesce(j->'pedidos', '[]')) p;
$$;

create or replace function carteira.aplicar_acoes(j jsonb) returns void
language sql set search_path = '' as $$
  delete from carteira.acoes where true;
  insert into carteira.acoes (chave, cliente, acao, repasse, por, atualizado_em)
  select k, split_part(k, '|', 1), v->>'acao', v->'repasse', j->>'por', (j->>'atualizadoEm')::timestamptz
  from jsonb_each(coalesce(j->'acoes', '{}')) e(k, v);
$$;

create or replace function carteira.aplicar_clientes_cadastrados(j jsonb) returns void
language sql set search_path = '' as $$
  insert into cadastro.clientes (codigo, razao, fantasia, porta)
  select k, sistema.txt(v->'razao'), sistema.txt(v->'nomeFantasia'), sistema.txt(v->'porta')
  from jsonb_each(coalesce(j->'clientes', '{}')) e(k, v)
  on conflict (codigo) do update set
    razao = coalesce(cadastro.clientes.razao, excluded.razao),
    fantasia = coalesce(cadastro.clientes.fantasia, excluded.fantasia),
    porta = excluded.porta;
$$;

create or replace function carteira.aplicar_faturados(j jsonb) returns void
language sql set search_path = '' as $$
  delete from carteira.faturados where true;
  insert into carteira.faturados (cliente, artigo, descricao, cor, pares)
  select c, a, v->>'desc', cor, (pares #>> '{}')::int
  from jsonb_each(coalesce(j->'faturados', '{}')) x(c, arts), jsonb_each(arts) y(a, v),
       jsonb_each(coalesce(v->'cores', '{}')) z(cor, pares);
$$;

create or replace function carteira.aplicar_giro_cortes(p_cliente text, j jsonb) returns void
language sql set search_path = '' as $$
  insert into carteira.giro_cortes (cliente, itens, atualizado_em, por)
  values (coalesce(j->>'cliente', p_cliente), coalesce(j->'itens', '[]'), (j->>'atualizadoEm')::timestamptz, j->>'por')
  on conflict (cliente) do update set itens = excluded.itens, atualizado_em = excluded.atualizado_em, por = excluded.por;
$$;

-- catalogo-historico/<código>.json (ou vitrine-<código>.json)
create or replace function catalogo.aplicar_historico(p_arquivo text, j jsonb) returns void
language plpgsql set search_path = '' as $$
declare
  v_origem text := case when p_arquivo like 'vitrine-%' then 'vitrine' else 'catalogo' end;
  v_dono   text := regexp_replace(p_arquivo, '^vitrine-', '');
begin
  delete from catalogo.pedidos where preposto = v_dono and origem = v_origem;
  insert into catalogo.pedidos (id, criado_em, preposto, preposto_nome, cliente, pagamento, tabela_preco, campanha,
      data_desejada, pedido_cliente, total_itens, valor_total, origem, extra)
  select distinct on (p->>'id') p->>'id', (p->>'createdAt')::timestamptz, coalesce(sistema.txt(p->'comissionista'), v_dono),
      p->>'comissionistaNome', p->>'clientCode', p->>'payment', p->>'priceTable', p->>'campaign', p->>'dataDesejada',
      p->>'pedidoCliente', (p->>'totalItens')::int, (p->>'valorTotal')::numeric, v_origem,
      sistema.resto(p, array['id','createdAt','comissionista','comissionistaNome','clientCode','payment','priceTable',
        'campaign','dataDesejada','pedidoCliente','totalItens','valorTotal','items'])
  from jsonb_array_elements(j) p
  on conflict (id) do nothing;
  insert into catalogo.pedido_itens (pedido_id, ordem, artigo, descricao, cor, quantidade, preco, dados)
  select p->>'id', (o - 1)::int, i->>'codigo', i->>'produto', i->>'cor',
      coalesce((i->>'totalQty')::int, (i->>'qty')::int), (i->>'preco')::numeric, i
  from (select distinct on (p->>'id') p from jsonb_array_elements(j) p) x,
       jsonb_array_elements(coalesce(p->'items', '[]')) with ordinality y(i, o)
  where exists (select 1 from catalogo.pedidos c where c.id = p->>'id' and c.preposto = v_dono and c.origem = v_origem);
end $$;

create or replace function catalogo.aplicar_rascunhos(p_preposto text, j jsonb) returns void
language sql set search_path = '' as $$
  delete from catalogo.rascunhos where preposto = p_preposto;
  insert into catalogo.rascunhos (id, preposto, dados)
  select coalesce(r->>'id', p_preposto || '-' || (o - 1)), p_preposto, r
  from jsonb_array_elements(j) with ordinality x(r, o);
$$;

create or replace function matriz.aplicar_estoque(j jsonb) returns void
language sql set search_path = '' as $$
  delete from matriz.itens where true; delete from matriz.pendentes where true; delete from matriz.lojas where true;
  insert into matriz.lojas (codigo, nome, cidade, token, ultima_atualizacao, extra)
  select l->>'codigo', l->>'nome', l->>'cidade', l->>'token', sistema.ms(l->'ultimaAtualizacaoLoja'),
      sistema.resto(l, array['codigo','nome','cidade','token','ultimaAtualizacaoLoja','marcas'])
  from jsonb_array_elements(coalesce(j->'lojas', '[]')) l;
  insert into matriz.itens (loja, marca, item_id, artigo, descricao, cor, preposto, estoque, venda, atualizado_em, extra)
  select distinct on (l->>'codigo', m, i->>'id') l->>'codigo', m, i->>'id', i->>'artigo', i->>'descricao', i->>'cor',
      sistema.txt(i->'preposto'), (i->>'estoqueAtual')::int, (i->>'venda')::int, sistema.ms(i->'atualizadoEm'),
      sistema.resto(i, array['id','artigo','descricao','cor','preposto','estoqueAtual','venda','atualizadoEm'])
  from jsonb_array_elements(coalesce(j->'lojas', '[]')) l, jsonb_each(coalesce(l->'marcas', '{}')) x(m, lista),
       jsonb_array_elements(lista) i;
  insert into matriz.pendentes (id, tipo, loja, loja_nome, marca, item_id, artigo, descricao, cor, status, criado_em,
      resolvido_em, extra)
  select p->>'id', p->>'tipo', p->>'lojaCodigo', p->>'lojaNome', p->>'marca', p->>'itemId', p->>'artigo', p->>'descricao',
      p->>'cor', p->>'status', sistema.ms(p->'criadoEm'), sistema.ms(p->'resolvidoEm'),
      sistema.resto(p, array['id','tipo','lojaCodigo','lojaNome','marca','itemId','artigo','descricao','cor','status','criadoEm','resolvidoEm'])
  from jsonb_array_elements(coalesce(j->'pendentes', '[]')) p;
$$;

-- ── o despachante ─────────────────────────────────────────────────────
-- Arquivos grandes publicados pelos robôs (detalhada, grades, RFV,
-- performance) ficam só guardados: quem os distribui é a cópia agendada.
create or replace function sistema.aplicar_arquivo(p_caminho text, j jsonb) returns text
language plpgsql set search_path = '' as $$
declare
  arq  text := regexp_replace(p_caminho, '^apps-oly/data/', '');
  nome text := regexp_replace(arq, '^.*/|\.json$', '', 'g');
begin
  case
    when arq = 'pedidos.json'                     then perform repasse.aplicar_pedidos(j);
    when arq = 'campanhas.json'                   then perform repasse.aplicar_campanhas(j);
    when arq = 'rateio.json'                      then perform repasse.aplicar_rateio(j);
    when arq = 'ocultos.json'                     then perform repasse.aplicar_ocultos(j);
    when arq = 'desmembramentos.json'             then perform repasse.aplicar_desmembramentos(j);
    when arq = 'links_compartilhados.json'        then perform repasse.aplicar_links(j);
    when arq like 'desejos/%'                     then perform repasse.aplicar_desejos(nome, j);
    when arq = 'dispo.json'                       then perform fabrica.aplicar_dispo(j);
    when arq = 'cancelamentos-dispo.json'         then perform fabrica.aplicar_cancelamentos(j);
    when arq = 'disponibilidades.json'            then perform fabrica.aplicar_disponibilidades(j);
    when arq = 'ocultos_disponibilidades.json'    then perform fabrica.aplicar_disp_ocultos(j);
    when arq = 'disponibilidades_imagens.json'    then perform fabrica.aplicar_imagens(j);
    when arq = 'exclusivos.json'                  then perform cadastro.aplicar_exclusivos(j);
    when arq = 'tabela_especial.json'             then perform cadastro.aplicar_tabela_especial(j);
    when arq = 'produtos.json'                    then perform cadastro.aplicar_produtos(j);
    when arq = 'fichas.json'                      then perform cadastro.aplicar_fichas(j);
    when arq like 'clientes/%'                    then perform cadastro.aplicar_clientes(nome, j);
    when arq = 'carteira-cms.json'                then perform carteira.aplicar_carteira_cms(j);
    when arq = 'carteira-cms-acoes.json'          then perform carteira.aplicar_acoes(j);
    when arq = 'carteira-cms-clientes.json'       then perform carteira.aplicar_clientes_cadastrados(j);
    when arq = 'carteira-cms-faturados.json'      then perform carteira.aplicar_faturados(j);
    when arq like 'giro-cortes/%'                 then perform carteira.aplicar_giro_cortes(nome, j);
    when arq like 'catalogo-historico/%'          then perform catalogo.aplicar_historico(nome, j);
    when arq like 'catalogo-rascunhos/%'          then perform catalogo.aplicar_rascunhos(nome, j);
    when arq = 'matriz_estoque.json'              then perform matriz.aplicar_estoque(j);
    when arq = 'app_status.json' then
      insert into sistema.status_app (app, pausado, mensagem) values ('portal', coalesce((j->>'paused')::boolean, false), coalesce(j->>'message', ''))
      on conflict (app) do update set pausado = excluded.pausado, mensagem = excluded.mensagem, atualizado_em = now();
    when arq = 'vitrine_status.json' then
      insert into sistema.status_app (app, pausado, mensagem) values ('vitrine', coalesce((j->>'pausada')::boolean, false), coalesce(j->>'motivo', ''))
      on conflict (app) do update set pausado = excluded.pausado, mensagem = excluded.mensagem, atualizado_em = now();
    when p_caminho = 'apps-oly-v2/data/tv_data.json' or p_caminho = 'apps-oly-v2/data/tv_gci_registry.json' then
      insert into sistema.documentos (chave, app, dados, origem) values ('v2/' || nome, 'apps-oly-v2', j, p_caminho)
      on conflict (chave) do update set dados = excluded.dados, atualizado_em = now();
    when p_caminho like 'kv/sacola:%'             then perform repasse.aplicar_sacola(substr(p_caminho, 4), j);
    when p_caminho like 'kv/gtmmix:%' then
      insert into repasse.mix_gtm (colecao, marca, preposto, dados)
      values (split_part(p_caminho, ':', 2), split_part(p_caminho, ':', 3), split_part(p_caminho, ':', 4), j)
      on conflict (colecao, marca, preposto) do update set dados = excluded.dados, atualizado_em = now();
    else return 'guardado';
  end case;
  return 'aplicado';
end $$;

-- O que o Worker chama (com a chave secreta)
create or replace function sistema.receber_arquivo(caminho text, conteudo jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  -- o arquivo inteiro é recolocado a cada gravação: sem isso a auditoria
  -- registraria centenas de "alterações" que ninguém fez
  perform set_config('cms.sem_auditoria', '1', true);
  insert into sistema.arquivos_vivos (caminho, conteudo, recebido_em, aplicado, erro)
  values (caminho, conteudo, now(), false, null)
  on conflict on constraint arquivos_vivos_pkey do update
    set conteudo = excluded.conteudo, recebido_em = now(), aplicado = false, erro = null;
  begin
    r := sistema.aplicar_arquivo(caminho, conteudo);
    update sistema.arquivos_vivos set aplicado = (r = 'aplicado') where arquivos_vivos.caminho = receber_arquivo.caminho;
  exception when others then
    -- o arquivo fica guardado com o erro; a cópia da noite acerta
    update sistema.arquivos_vivos set erro = sqlerrm where arquivos_vivos.caminho = receber_arquivo.caminho;
    r := 'erro: ' || sqlerrm;
  end;
  return r;
end $$;

revoke execute on function sistema.receber_arquivo(text, jsonb) from public, anon, authenticated;
grant execute on function sistema.receber_arquivo(text, jsonb) to service_role;

-- o Worker entra com a chave secreta (service_role): só precisa chegar à função
grant usage on schema sistema to service_role;
