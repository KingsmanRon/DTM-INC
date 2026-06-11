# V2 Fix Plan — full register (from 2026-06-10 codebase review + repackaging items)

> **STATUS UPDATE 2026-06-11:** the batch implementation landed in the working
> tree (NOT yet committed/deployed — owner go-ahead pending). "Implemented"
> below = code/migration exists in this tree and passes typecheck + lint +
> unit tests + production build. See "Deployment order" at the bottom —
> migrations 0042–0051 MUST be applied to the prod DB BEFORE the code deploys.

Goal: harden and de-brand this codebase so it can be repackaged as **v2 for a new practice**
(separate Supabase + Vercel deployment per client — NOT multi-tenant, per §15).

**Columns**
- **Effort:** XS (<30 min) · S (≤ half day) · M (1–2 days) · L (multi-day)
- **Prod risk:** risk of disturbing the LIVE DTM deployment.
- **Mig?:** needs a DB migration applied to prod (number given).
- **Status:** Implemented / Deferred (+why) / Action required (+whose).

## Wave 1 — Quick wins

| # | Fix | Effort | Prod risk | Mig? | Status |
|---|-----|--------|-----------|------|--------|
| 6 | CI release gate runs on the prod branch | XS | None | No | Implemented |
| 5 | `file_number_reservations` captured in-repo | S | None | 0042 (no-op on prod) | Implemented — **verify columns vs prod before first fresh-DB use (query in 0042 header)** |
| 2 | Row-count checks on archive/unarchive/finalise; admin archive actually works (service-role per 0002 design); audit only real transitions | S | Low | No | Implemented |
| 12 | Middleware matcher covers `/billing` + sync warning | XS | Low | No | Implemented |
| 21 | No `count:"exact"`; search 500s on DB error; ID numbers masked in type-ahead | S | Low | No | Implemented |
| 16 | Audit metadata sanitizer (float canonicalisation divergence) | S | None | No | Implemented |
| 8 | consent_records immutable: UPDATE policy dropped, privileges revoked, guard trigger | S | Low | 0043 | Implemented |
| 28 | Stale docs marked superseded; .env.example rewritten to reality | S | None | No | Implemented |
| 27 | Local `npm install` done (tests now pass locally) | XS | None | No | **Action required (owner): move repo out of OneDrive** |

## Wave 2 — Hardening

| # | Fix | Effort | Prod risk | Mig? | Status |
|---|-----|--------|-----------|------|--------|
| 7 | `onboard_patient` checks app role (doctor/staff) in-function | S | Low | 0045 | Implemented |
| 9 | RLS client replaces service-role where RLS suffices (notes insert, amend route, documents finalize) | M | Low–Med | No | Implemented |
| 11 | KEK dev-fallback fails CLOSED in production (also fixes the `"false"`-is-truthy coerce bug) | XS | Low* | No | Implemented — **Action required (owner): verify prod Vault read (`select read_app_secret(...)`) BEFORE deploy** |
| 18 | Document soft-archive (Remove button + DELETE route + `document_archive` audit) | S–M | Low | No | Implemented — covers the 2026-06-11 wrong-referral incident class |
| 22 | `patient_view` audit on profile page + bundle GET | S | Low | 0046 | Implemented |
| 23 | Audit admin page: action/patient filters, pagination, expandable metadata, chain position | S–M | None | No | Implemented |
| 24 | Dead config removed (PDF_SERVICE_*, SUPABASE_AUDIT_DB_URL, SENTRY_DSN refs); `user_invites` table dropped; invite flow uses `pending_invite` → activated at first sign-in; invite links land on set-password | S–M | Low | 0050 | Implemented |

## Wave 3 — V2 repackaging

| # | Fix | Effort | Prod risk | Mig? | Status |
|---|-----|--------|-----------|------|--------|
| 29 | Hospitals + prefixes are DATA (`public.hospitals`): RPC lookup, FK constraints replace CHECKs, all dropdowns/filters/validation read the table | M–L | Med | 0044 + 0045 | Implemented |
| 30 | White-label: `src/lib/branding.ts` (login/metadata/manifest/MFA issuer via NEXT_PUBLIC_*), PDF logo lazy-loaded from practice-brand storage w/ bundled fallback | M | Low–Med | No | Implemented |
| 31 | Consent cards from `practice_settings.consent_cards` (admin-editable; DTM wording as default) | S–M | Low | 0051 | Implemented |
| 32 | New-practice deployment runbook | M | None | No | Written — **Action required: dry-run against a scratch project** |
| 33 | Per-client §15 decisions template | S | None | No | Template ready — **Action required: client answers** |
| 14 | pgTAP authz/RLS suite + workflow (also proves migrations rebuild from scratch) | L | None | No | Implemented — **first CI run may need iteration (new harness, not yet executed)** |
| 15 | Canonical function files auto-generated + drift check in release gate (`npm run check:functions`) | M | None | No | Implemented |

## Wave 4 — Integrity upgrades

| # | Fix | Effort | Prod risk | Mig? | Status |
|---|-----|--------|-----------|------|--------|
| 1 | `chain_position` + DB-clock `created_at` (no false chain-breaks, no backdating); verifiers walk by position | M | Med | 0048 | Implemented |
| 4 | `occurred_at` preserves original event time through the outbox | S | Low | 0048 | Implemented |
| 3 | Server-side login/logout: login_success/failure/lockout + logout audited; last_login_at; 5-strikes/15-min lockout | M | Med | No | Implemented |
| 10 | `update_patient_bundle` RPC: transactional PATCH, hospital immutable (PT409), contact-id rule | M | Med | 0047 | Implemented |
| 17 | Incremental chain verification w/ checkpoint + `?full=true` + runbook | M | Low | 0049 | Implemented |
| 19 | Break-glass admin UI (+ list endpoint) + runbook | M | Low | No | Implemented |
| 20 | Wizard: per-step validation, sessionStorage draft, Section B Title field, B-ID Luhn warning, full pre-submit validation | M | Low | No | Implemented |
| 25 | Idle auto-logout per role (audited as logout reason=idle) | M | Low | No | Implemented |
| 26 | Nonce-based CSP | M | Med | No | **Deferred** — needs runtime verification; design in docs/internal/csp-nonce-design.md |
| 13 | Role-in-JWT custom claims | L | High | Config | **Deferred** — needs Supabase dashboard hook + revocation design; docs/internal/role-in-jwt-design.md |

## Deployment order (critical)
1. **Verify prod Vault**: `select public.read_app_secret('clinical-notes-kek');` returns the key (item 11 fails closed after deploy).
2. **Apply migrations 0042 → 0051 in order** to the prod DB (one window). All are
   additive/idempotent for the running OLD code — old code keeps working after
   they apply (0045's role check passes for doctor/staff; 0048's writer is
   signature-compatible; the legacy verifier order remains valid for DB-clock rows).
3. **Then deploy the code** (it requires 0044/0046/0047/0048/0049 to exist).
4. Post-deploy checks: sign in (login_success row + last_login_at), open a patient
   (patient_view row), run `/api/v1/internal/verify-audit-chain?full=true`,
   archive a test document, generate both PDFs, billing batch loads.
5. The 2026-06-11 mis-uploaded referral letter: remove it through the new
   Documents → Remove button once deployed (audited), or SQL-archive it now
   (update patient_documents set archived_at = now(), archived_by = '<uuid>'
   where id = '<doc-id>') and note the correction out of band.

## Dependencies / notes
- 4 rides on 1 (0048). 10 partially rides on 29 (0044/0045).
- Login flow behaviour change: sign-in now POSTs to `/api/v1/auth/login`
  (cookies set server-side); MFA enrol/challenge unchanged. The login page's
  old `?debug_auth=1` verbose console logging was removed (server audits now).
- `user_invites` drop (0050) is the only destructive migration — the table was
  empty/unused since 0001; confirm `select count(*) from user_invites;` = 0
  before applying if in doubt.
- Deploy policy unchanged: branch + PR + release-gate + owner sign-off.
