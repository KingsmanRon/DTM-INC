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
--   1. Edit the three values in the `params` CTE below (p_email, p_role,
--      p_full_name). They're the single source of truth — used by both the
--      upsert and the sanity-check select.
--   2. Run the whole file.
--   3. Sign in at /login.
--
-- Roles:
--   'staff'  → no MFA required, fastest E2E path.
--   'doctor' / 'admin' → MFA mandatory; you'll be sent to /mfa/enrol on first
--                        sign-in to set up a TOTP authenticator.

with params as (
  select
    'test@example.com'::text  as p_email,        -- ← change me
    'staff'::role_name         as p_role,         -- 'staff' | 'doctor' | 'admin'
    'Test User'::text          as p_full_name     -- ← change me
),
au as (
  select u.id, u.email
  from auth.users u, params p
  where u.email = p.p_email
),
r as (
  select id, name from roles, params p where roles.name = p.p_role
),
upserted as (
  insert into app_users (id, email, full_name, role_id, status, mfa_enabled)
  select au.id,
         au.email,
         p.p_full_name,
         r.id,
         'active'::user_status,
         p.p_role in ('doctor','admin')
  from params p, au, r
  on conflict (id) do update
     set status      = 'active',
         role_id     = excluded.role_id,
         full_name   = excluded.full_name,
         updated_at  = now()
  returning id, email, full_name, role_id, status
)
-- Sanity check — should return exactly one row with status = 'active'.
-- Empty result means the email does not exist in auth.users (create it first).
select u.email, u.full_name, u.status, r.name as role
from upserted u join roles r on r.id = u.role_id;
