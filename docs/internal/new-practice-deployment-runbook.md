# New-practice deployment runbook (v2 repackaging)

How to stand up this codebase for a NEW practice as an isolated deployment
(own Supabase project, own Vercel project, own keys). Multi-tenant is a §15
locked NO — isolation per client is the design.

Dry-run this once against a scratch Supabase project before the real client
deployment, and tick each step.

## 0. Prerequisites
- [ ] Client decisions captured: `docs/internal/client-decisions-template.md` completed and signed off.
- [ ] Sanitized repo (no DTM patient data, no DTM secrets) is the deployment source.
- [ ] DPAs with Supabase + Vercel cover POPIA s.72 for the new client.

## 1. Supabase project
- [ ] Create project in EU (Frankfurt) or closer POPIA-acceptable region. Enable PITR.
- [ ] Apply ALL migrations in order (`supabase db push` or psql). The repo is
      self-contained from 0001 → latest (verified by the authz-tests workflow,
      which rebuilds from scratch).
- [ ] Verify `select count(*) from public.hospitals;` — then REPLACE the seeded
      DTM hospitals with the client's:
      `update/insert public.hospitals (name, file_prefix, display_order)…`
      (deactivate rather than delete anything already referenced).
- [ ] Vault: create the clinical-notes KEK per `docs/internal/vault-setup.md`
      (new 32-byte key — NEVER reuse another practice's KEK), confirm
      `read_app_secret` returns it.
- [ ] Bootstrap admin: `supabase/seed-bootstrap-admin.sql` (edit email first),
      then promote per `docs/internal/promote-auth-user-to-app-admin.md`.
- [ ] practice_settings row (id=1): update practice_name, tagline,
      practice_number, doctor_name, doctor_qualifications, practice_address,
      practice_phone, information_officer_*, active_consent_version/body,
      consent_cards (0051), privacy_notice_body. The 0001 defaults are DTM's —
      they MUST be overwritten here.
- [ ] Auth settings: Site URL = the production domain; email templates branded;
      SMTP configured. Password policy ≥ 12 chars.

## 2. Brand assets
- [ ] Replace `public/brand/logo.png` (header) and add the letterhead PNG either
      as `public/brand/logo-pdf.png` OR upload to the `practice-brand` bucket and
      set `practice_settings.logo_path` (preferred — no code change).
- [ ] Replace `public/icons/*` (favicons, apple-touch, maskable).

## 3. Vercel project
- [ ] Region pinned (fra1 or closest to the client).
- [ ] Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
      `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` (fresh random),
      `CLINICAL_NOTES_KEK_ID`, `CLINICAL_NOTES_KEY_PROVIDER=vault`,
      `ALLOW_DEV_KEK_FALLBACK` UNSET (prod fails closed by default; see env.ts),
      `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_TITLE`, `NEXT_PUBLIC_APP_DESCRIPTION`,
      `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_SITE_URL` (production domain),
      `SESSION_IDLE_TIMEOUT_*` if differing from 30/15/15,
      handwriting flags OFF until the client's doctor is allowlisted.
- [ ] Crons present (vercel.json ships them): verify both fire and return 200
      after first deploy.
- [ ] Branch protection: release-gate required; no direct pushes to the deploy branch.

## 4. Verification before go-live (mirror go-live-owner-checklist.md)
- [ ] Sign in as bootstrap admin; MFA enrolment forced.
- [ ] Invite a staff user; invite email → set password → first sign-in flips
      status pending_invite → active; `last_login_at` populates.
- [ ] Onboard a test patient at each configured hospital — file numbers carry
      the right prefixes; onboarding PDF renders with the client's letterhead.
- [ ] Upload + view + rename + REMOVE a document; verify audit rows for each.
- [ ] Doctor: create/finalise/void a note; staff account sees no Clinical tab,
      gets 404 on the notes API.
- [ ] Audit page shows the trail; `/api/v1/internal/verify-audit-chain?full=true`
      returns ok.
- [ ] Run the pgTAP suite against a shadow copy if any client-specific SQL was added.
- [ ] Hard-delete the test patient via the documented test-data tooling
      (`docs/internal/test-data-hard-delete.md`) BEFORE real use.

## 5. Hand-over
- [ ] Owner sign-off per `docs/internal/go-live-owner-checklist.md`.
- [ ] Record the deployment in the ops register (project refs, regions, contacts,
      KEK id, cron secret location).
