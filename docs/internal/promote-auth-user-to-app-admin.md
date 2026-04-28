# Promote a Supabase Auth user to DTM app admin

This system has **two separate concepts** of admin:

1. **Supabase Auth admin (dashboard/project operator)**
   - manages Auth users/settings in Supabase.
   - does **not** automatically grant in-app admin rights.
2. **DTM app admin role**
   - stored in `public.app_users` via `role_id -> public.roles(name='admin')`.
   - required for `/dashboard` + `/admin/*` authorisation decisions in the app.

## Why users reach `/unauthorised`

A user can authenticate successfully with Supabase Auth and still be denied app access if:
- no `app_users` row exists for `auth.users.id`,
- `status` is not `active`, or
- no role mapping exists.

## One-time/admin promotion SQL

Run `supabase/seed-bootstrap-admin.sql` in Supabase SQL editor, editing the `params` CTE values first.

It will:
- verify the Auth user exists in `auth.users`,
- upsert `public.app_users` with role `admin`,
- set `status='active'`,
- return the effective role/status row for verification.

## Post-promotion expected flow

- Authenticated + `app_users.role=admin` + `status=active`:
  - routed into protected layout,
  - then MFA gate applies (doctor/admin must complete MFA to reach dashboard).
- Authenticated but missing/invalid app row:
  - routed to `/unauthorised`.

