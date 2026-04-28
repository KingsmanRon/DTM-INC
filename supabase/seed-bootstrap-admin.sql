-- seed-bootstrap-admin.sql
-- Purpose: safely promote an existing auth.users account to app admin.
--
-- Edit params first, then run in Supabase SQL Editor.

with params as (
  select
    'c9322dab-476b-4065-9bf7-011ec980185d'::uuid as p_user_id,
    null::text as p_email_override,
    'Initial Admin'::text as p_full_name
),
auth_user as (
  select u.id, u.email
  from auth.users u
  join params p on p.p_user_id = u.id
),
role_row as (
  select r.id as role_id
  from roles r
  where r.name = 'admin'::role_name
),
upserted as (
  insert into app_users (id, email, full_name, role_id, status, mfa_enabled)
  select
    au.id,
    coalesce(p.p_email_override, au.email),
    p.p_full_name,
    rr.role_id,
    'active'::user_status,
    true
  from params p
  join auth_user au on true
  join role_row rr on true
  on conflict (id) do update
    set email       = excluded.email,
        full_name   = excluded.full_name,
        role_id     = excluded.role_id,
        status      = 'active',
        updated_at  = now()
  returning id, email, full_name, role_id, status, mfa_enabled
)
select
  u.id,
  u.email,
  u.full_name,
  u.status,
  r.name as role,
  u.mfa_enabled
from upserted u
join roles r on r.id = u.role_id;

-- If result is empty, the provided p_user_id does not exist in auth.users.
