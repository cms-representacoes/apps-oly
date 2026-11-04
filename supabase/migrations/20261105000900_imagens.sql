-- Portal CMS · migração 9: banco de imagens
--
-- Bucket público "imagens" (foto de produto não é sigilosa), com uma pasta
-- só de fotos de produto para todas as telas:
--
--   produtos/        Catalogo (apps-oly) + imagens_olympikus (apps-oly-v2), sem
--                    repetição; com duas versões do mesmo nome, fica a mais nova
--   produtos/mini/   miniaturas de 420px geradas dessas fotos
--   portal/          apps-oly/imagens_olympikus (categorias e banner do portal)
--
-- O índice guarda o md5 da foto de origem (também para a miniatura): o
-- envio da noite só manda o que é novo ou mudou.

create table if not exists sistema.imagens (
  caminho       text primary key,               -- caminho dentro do bucket
  md5           text not null,
  bytes         bigint not null,
  enviado_em    timestamptz not null default now()
);
alter table sistema.imagens enable row level security;
drop policy if exists admin_tudo on sistema.imagens;
create policy admin_tudo on sistema.imagens for all to authenticated
  using (sistema.sou_admin()) with check (sistema.sou_admin());

-- Qual foto de origem virou cada imagem (só quando o mesmo nome existe nas
-- duas pastas). Linhas "fonte/<repo>/<pasta>/<nome>" guardam o md5 de cada
-- origem: na noite seguinte, a versão que mudou é a mais nova e ganha; se
-- nenhuma mudou, vale a escolha anterior. Não depende do histórico do git.
alter table sistema.imagens add column if not exists origem text;
