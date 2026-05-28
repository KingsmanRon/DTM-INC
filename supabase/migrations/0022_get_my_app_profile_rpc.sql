-- Resolve the signed-in user's staff profile without relying on an embedded
-- PostgREST relationship join during login/session checks.

create or replace function public.get_my_app_profile()
returns table (
  id uuid,
  email text,
  full_name text,
  status text,
  role_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    au.id,
    au.email,
    au.full_name,
    au.status::text as status,
    r.name::text as role_name
  from public.app_users au
  left join public.roles r
    on r.id = au.role_id
  where au.id = auth.uid()
  limit 1;
$$;

revoke all on function public.get_my_app_profile() from public;
grant execute on function public.get_my_app_profile() to authenticated;
