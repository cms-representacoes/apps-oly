-- Portal CMS · migração 6: arquivos com dono no Storage
--
-- RFV e Performance são planilhas com todos os vendedores. A cópia da noite
-- grava uma versão completa (pasta "todos", só CMS/DEV) e uma por vendedor
-- (pasta com o código dele, só as linhas/aba dele):
--
--   relatorios/<relatorio>/<dono>/<arquivo>     dono = todos | código do perfil
--
-- Planilhas de cadastro (Produtos, Clientes, DISPO) ficam no bucket
-- "planilhas": produtos qualquer login lê; o resto, só CMS/DEV.

alter table relatorios.arquivos add column if not exists dono text not null default 'todos';
alter table relatorios.arquivos drop constraint if exists arquivos_pkey;
alter table relatorios.arquivos add primary key (relatorio, chave, dono);

drop policy if exists ler on relatorios.arquivos;
create policy ler on relatorios.arquivos for select to authenticated
  using (dono = sistema.meu_codigo());

-- Storage: quem lê o quê
drop policy if exists relatorios_ler on storage.objects;
create policy relatorios_ler on storage.objects for select to authenticated
  using (bucket_id = 'relatorios' and (
    ((storage.foldername(name))[2] = 'todos' and sistema.sou_admin())
    or (storage.foldername(name))[2] = sistema.meu_codigo()));

drop policy if exists planilhas_ler on storage.objects;
create policy planilhas_ler on storage.objects for select to authenticated
  using (bucket_id = 'planilhas' and (
    sistema.sou_admin() or (storage.foldername(name))[1] = 'produtos'));

drop policy if exists arquivo_ler on storage.objects;
create policy arquivo_ler on storage.objects for select to authenticated
  using (bucket_id = 'arquivo' and sistema.sou_admin());
