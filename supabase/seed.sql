-- seed.sql — run AFTER 0001–0004 migrations.
-- Idempotent. Paste into Supabase SQL Editor and run as a single query.
--
-- This codifies the manual steps from the deploy runbook so staging/prod
-- aren't retyped.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Practice consent + privacy body
--    Review the text with the doctor before go-live.
-- ═══════════════════════════════════════════════════════════════════════════

update practice_settings set
  active_consent_version = '1.0.0',
  active_consent_body = $BODY$
I hereby consent to treatment by Dr. Thomas Mtshali (Specialist
Laparoscopic and General Surgeon) and authorise Dr. Thomas Mtshali Inc.
to process my personal and health information for the purposes of
providing medical care, keeping clinical records as required by the
Health Professions Council of South Africa, and claiming from my
medical aid where applicable.

I confirm the information I have provided is correct to the best of
my knowledge. I understand my rights under the Protection of Personal
Information Act, 2013 (POPIA), including the right to access,
correction, and — subject to legal retention rules — deletion of my
personal information.
$BODY$,
  privacy_notice_body = $BODY$
Dr. Thomas Mtshali Inc. processes your personal information under the
Protection of Personal Information Act, 2013 (POPIA). Health
information is treated as special personal information under POPIA
sections 26–27.

We collect the minimum information necessary to provide your care,
keep records as required by the HPCSA, and — where applicable —
submit claims to your medical aid. We do not sell, rent, or share
your information for marketing.

For any request relating to your personal information, contact our
Information Officer below.
$BODY$,
  information_officer_email = 'drmtshalitm@gmail.com',
  updated_at = now()
where id = 1;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Bootstrap first admin user
--    REQUIRES: the person has already been invited via Supabase Auth and has
--    set their password + enrolled TOTP. Copy their auth.users.id below.
--
--    Uncomment and fill in once you have the auth UID.
-- ═══════════════════════════════════════════════════════════════════════════

-- insert into app_users (id, email, full_name, role_id, status, mfa_enabled)
-- select
--   '00000000-0000-0000-0000-000000000000'::uuid,  -- <-- paste auth.users.id
--   'ronald@inntris.com',
--   'Ronald Maduna',
--   r.id,
--   'active',
--   true
-- from roles r where r.name = 'admin'
-- on conflict (id) do nothing;

-- Doctor:
-- insert into app_users (id, email, full_name, role_id, status, mfa_enabled)
-- select '00000000-0000-0000-0000-000000000000'::uuid,
--        'thomas@dtminc.co.za', 'Dr. Thomas Mtshali',
--        r.id, 'active', true
-- from roles r where r.name = 'doctor'
-- on conflict (id) do nothing;

-- Reception:
-- insert into app_users (id, email, full_name, role_id, status, mfa_enabled)
-- select '00000000-0000-0000-0000-000000000000'::uuid,
--        'reception@dtminc.co.za', 'Reception',
--        r.id, 'active', false
-- from roles r where r.name = 'staff'
-- on conflict (id) do nothing;
