-- 0050_drop_user_invites.sql — remove the dead invites table (review P3#24).
--
-- The invite flow shipped on Supabase Auth's admin inviteUserByEmail API
-- (POST /api/v1/admin/users/invite) and never wrote to user_invites; the table
-- has been empty, unreferenced scaffolding since 0001. Dropping it removes a
-- confusing second source of truth for invitations.
--
-- (The related app_users.status = 'pending_invite' value is NOT dropped — the
-- invite route now uses it correctly: invited users are created pending and
-- activated on first sign-in via /auth/callback.)

begin;

drop table if exists public.user_invites;

commit;
