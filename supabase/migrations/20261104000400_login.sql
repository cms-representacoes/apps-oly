-- Portal CMS · migração 4: login
--
-- O convite cria o usuário no Auth com o e-mail que está no perfil; este
-- gatilho liga os dois na hora. Cadastro aberto fica desligado no projeto
-- (só entra quem foi convidado).

create or replace function sistema.ligar_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update cadastro.perfis set user_id = new.id
   where lower(email) = lower(new.email) and user_id is null;
  return new;
end $$;

create trigger ligar_perfil after insert on auth.users
  for each row execute function sistema.ligar_perfil();

-- O que a tela precisa saber de quem entrou
create or replace function sistema.meu_perfil()
returns table (codigo text, nome text, papel text)
language sql stable security definer set search_path = '' as $$
  select codigo, nome, papel from cadastro.perfis where user_id = auth.uid() and ativo
$$;
revoke execute on function sistema.meu_perfil() from public, anon;
grant execute on function sistema.meu_perfil() to authenticated;
