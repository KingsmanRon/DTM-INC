-- Supabase Vault helper wrappers for app-level KEK retrieval/rotation.
-- Assumes extension supabase_vault is already installed in schema `vault`.

create or replace function public.create_app_secret(
  p_name text,
  p_value text,
  p_description text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'p_name is required' using errcode = '22023';
  end if;
  if p_value is null or btrim(p_value) = '' then
    raise exception 'p_value is required' using errcode = '22023';
  end if;

  v_secret_id := vault.create_secret(p_value, p_name, p_description);
  return v_secret_id;
end;
$$;

create or replace function public.read_app_secret(
  p_name text
)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret text;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'p_name is required' using errcode = '22023';
  end if;

  select ds.decrypted_secret
    into v_secret
    from vault.decrypted_secrets ds
   where ds.name = p_name
   order by ds.created_at desc
   limit 1;

  if v_secret is null then
    raise exception 'secret not found: %', p_name using errcode = 'P0002';
  end if;

  return v_secret;
end;
$$;

create or replace function public.update_app_secret(
  p_name text,
  p_value text,
  p_description text default null
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'p_name is required' using errcode = '22023';
  end if;
  if p_value is null or btrim(p_value) = '' then
    raise exception 'p_value is required' using errcode = '22023';
  end if;

  select s.id into v_secret_id
    from vault.secrets s
   where s.name = p_name
   order by s.created_at desc
   limit 1;

  if v_secret_id is null then
    perform vault.create_secret(p_value, p_name, coalesce(p_description, ''));
    return;
  end if;

  perform vault.update_secret(v_secret_id, p_value, p_name, coalesce(p_description, ''));
end;
$$;

revoke all on function public.create_app_secret(text, text, text) from public;
revoke all on function public.read_app_secret(text) from public;
revoke all on function public.update_app_secret(text, text, text) from public;

grant execute on function public.read_app_secret(text) to service_role;
grant execute on function public.create_app_secret(text, text, text) to service_role;
grant execute on function public.update_app_secret(text, text, text) to service_role;
