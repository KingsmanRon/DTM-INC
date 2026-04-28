-- seed-dev-user.sql — DEV ONLY. Bridges Supabase Auth to app_users so the
-- chosen email can actually reach /dashboard.
--
-- Why this exists:
--   resolveSession() (src/lib/auth/session.ts) requires a row in app_users
--   keyed by auth.users.id with status = 'active' and a role. Without it,
--   the (authed) layout redirects back to /login on first sign-in.
--
-- Prerequisite:
--   The email must already exist in auth.users. Create it via the Supabase
--   dashboard (Authentication → Users → Add user) or magic-link signup, set
--   a password, then run this script.
--
-- Usage (Supabase SQL Editor):
--   1. Edit the two values in the `params` CTE below.
--   2. Run the whole file.
--   3. Sign in at /login.
--
-- Roles:
--   'staff'  → no MFA required, fastest E2E path.
--   'doctor' / 'admin' → MFA mandatory; you'll be sent to /mfa/enrol on first
--                        sign-in to set up a TOTP authenticator.

with params as (
  select
    'test@example.com'::text as p_email,        -- ← change me
    'staff'::text             as p_role,         -- 'staff' | 'doctor' | 'admin'
    'Test User'::text         as p_full_name     -- ← change me
),
au as (
  select u.id, u.email
  from auth.users u, params p
  where u.email = p.p_email
),
r as (
  select id, name from roles, params p where roles.name = p.p_role::role_name
)
insert into app_users (id, email, full_name, role_id, status, mfa_enabled)
select au.id,
       au.email,
       p.p_full_name,
       r.id,
       'active'::user_status,
       case when p.p_role in ('doctor','admin') then true else false end
from params p, au, r
on conflict (id) do update
   set status      = 'active',
       role_id     = excluded.role_id,
       full_name   = excluded.full_name,
       updated_at  = now();

-- Sanity check — should return one row with status = 'active'.
select u.email, u.full_name, u.status, r.name as role
from app_users u join roles r on r.id = u.role_id
where u.email = (select p_email from (select 'test@example.com'::text as p_email) p);
