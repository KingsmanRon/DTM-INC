# Client baseline implementation report

Validation date: 28 September 2026. This report records the validation snapshot before the authorised feature branch commit and push. Status: implemented and validated locally; new practice production acceptance remains pending.

## 1. Architecture assessment

The application remains a Next.js responsive PWA serving one legal practice, with a dedicated Supabase database, Auth, private Storage and Vault environment. Facilities are reference records inside that practice. No tenancy layer or additional product subsystem was introduced.

The existing seven section intake, patient registry and archive lifecycle, retired file number lookup, private patient reports, onboarding PDF, doctor clinical notes, AES 256 GCM envelope encryption, handwritten feature flags, billing XLSX, audit chain/outbox and break glass routes remain in place. Staff and administrators have no ordinary clinical note access. All three roles now require MFA/AAL2.

The original tree was checked before editing. The branch remains `codex/client-onboarding-baseline`; HEAD remains `20bf4f2118e0d4147a58858cc353c3130fa71db6`, the requested branch point. No commit, push, merge or deployment was performed. The live DTM Supabase and Vercel environments were not contacted. Preexisting `.claude/` files were preserved.

## 2. Changes made

Added a strict nonsecret practice configuration, offline SQL generation, supplied asset preparation and isolated deployment staging. Bootstrap refuses populated databases and mismatched configurations; an exact repeat is harmless. Initial profiles bind to actual Auth accounts and generate audit events. No client secrets or real patient data are embedded.

New client builds use supplied practice identity, privacy/consent settings, facilities, file conventions, public branding and assets. DTM defaults and assets remain available to the original deployment. The staged client public directory contains only supplied assets and the service worker.

Added the security migration, database regression tests, local bootstrap integration tests, service worker tests and CI database advisors. Removed browser persistence of intake drafts and restricted offline caching to installation metadata/icons. Updated vulnerable dependencies without changing the Next.js major version; Node 22 is required.

## 3. Files changed

The complete path inventory is [changed files](evidence/client-changed-files.json). Main additions are:

1. [Onboarding runbook](client-onboarding-runbook.md), [owner information](client-information-required.md), [environment checklist](client-environment-checklist.md), [go live checklist](client-go-live-checklist.md), [security review](client-security-review.md) and [practice value audit](client-practice-value-audit.md).
2. `config/client.example.json`; `scripts/lib/client-config.ts`; preparation, asset, staging and deployment check scripts.
3. `supabase/migrations/20260928112841_client_baseline_security.sql`, `supabase/tests/client_security.test.sql`, `supabase/verify-client-baseline.sql` and regenerated canonical functions.
4. `scripts/test-client-bootstrap.ts`, config tests and `src/lib/pwa-cache.test.ts`.
5. Branding, PDF logo, privacy, installation, manifest/layout, MFA/session, settings and intake draft modules; package/lockfile, CI, local Supabase config and historical seed guidance.

## 4. Security findings fixed

Closed default RPC execution and moved secret administration, destructive cleanup and maintenance implementations into a private schema. Service compatibility wrappers use SECURITY INVOKER and restricted grants. Authenticated RPCs enforce identity and application roles; billing derives its actor from the JWT. All application function search paths are deterministic.

Enforced staff MFA and restrictive AAL2 policies. Closed direct profile/role and break glass writes that could bypass audited server controls. Enabled outbox RLS and removed browser grants. Corrected private storage policies, removed the public extension advisor finding and fixed function volatility lint. Added consent verification at the onboarding RPC boundary. The allocator preserves retired numbers and does not truncate long sequences.

See the security review for the complete function inventory, including every RPC named in the specification.

## 5. Security findings and decisions still outstanding

Hosted Auth settings cannot be established locally. Leaked password protection, SMTP, exact redirects, closed signup, TOTP enrolment, secret custody, backups and hosted advisors must be verified on the new project. No claim is made about unknown live DTM schema drift.

Existing break glass has a 48 hour cooldown and a 24 hour access window, but no doctor approval step and no implemented automatic doctor notification. The owner must approve and rehearse a manual notification/review process or commission a separate product change before go live. Direct database timing changes are now denied.

Existing route auditing and the durable outbox are preserved; this change does not make every business mutation and its audit event a single atomic transaction. No security control was weakened to pass tests.

## 6. Fresh environment validation

All 57 migrations replayed successfully from an empty disposable local Supabase database using CLI 2.118.0 and Supabase PostgreSQL 17.6.1.171. No seed or production state was required. Local ports and the named validation container are isolated from the other local project.

The database suite passed 121 assertions covering anon, doctor, staff and admin, AAL1 restrictions, clinical isolation, secret/maintenance denial, actor spoofing, storage protection and direct administrative write denial. The bootstrap integration passed 13 assertions covering supplied settings/facilities, initial sequences, safe free text, repeatability, populated database refusal, real Auth ID binding, audit creation, consent onboarding and billing staging. All synthetic fixture changes rolled back.

Local security advisors returned no issues with `--fail-on warn`. SQL lint returned no schema errors for `public,private`. This is source reproducibility evidence, not a production drift comparison.

## 7. Application validation

1. `npm ci`: passed; dependency audit reported zero vulnerabilities. A retry was needed after stopping the local server that held a Windows image library open.
2. App and scripts TypeScript checks: passed.
3. Vitest: 16 files, 117 tests passed, including audit chain, document handling, clinical PDF, MFA and new configuration/cache restrictions.
4. Canonical function check: all 11 definitions match their migrations.
5. Production builds: original compatibility mode and isolated synthetic client mode passed.
6. Lint: passed with three existing warnings concerning a document refresh effect dependency, the MFA QR image element and an unused SA ID variable. Vitest also reports a future Vite configuration loader advisory; tests pass without suppressing it.
7. `git diff --check`: passed.
8. Browser checks: synthetic client demo at 390 by 844, 768 by 1024 and 1440 by 900 pixels had no horizontal overflow and no displayed DTM/Mtshali text. Login and all role MFA guidance rendered correctly. The standalone manifest used the supplied identity; both icon URLs returned 200. Offline navigation displayed only a generic reconnect screen. Screenshots are retained locally under ignored `output/playwright/`.

Browser checks used synthetic public screens with no Supabase credentials. They do not prove authenticated hosted flows or actual iOS installation/Apple Pencil behaviour. Those checks remain in the acceptance checklist.

## 8. Exact client information still required

You must obtain legal/display name, speciality, practice number, doctor name/qualifications, address/phone, Information Officer name/email, approved privacy notice, versioned consent body and summary cards, approved logo/letterhead/icon, every facility name/prefix/order/active state, approved file format and next unused counters, each initial user's name/email/role, app name/title/description and final HTTPS origin.

You also need project ownership/region, domain/DNS control, billing responsibility, feature approvals, supported devices, backup/recovery ownership and the break glass operating decision. [The information checklist](client-information-required.md) maps each value to its destination. Actual practice values remain unsupplied.

## 9. Your Supabase and Vercel steps

Follow [the executable runbook](client-onboarding-runbook.md) in order:

1. Review the supplied configuration and generated SQL/assets.
2. Create a new Supabase project and apply the full migration history to its empty application database.
3. Run the reviewed bootstrap before creating Auth users. Verify all supplied reference settings and counters.
4. Verify both private buckets, upload the approved letterhead, create a unique Vault KEK and configure recovery.
5. Configure Auth, SMTP, redirects, password protection and TOTP; create/invite the actual initial users and apply their profile binding SQL.
6. Stage isolated client source, create a new Vercel project on Node 22, set the documented public configuration and new secrets, and configure the final domain.
7. Run all quality gates, hosted advisors and role tests in the appropriate disposable environment. Deploy only to the newly verified project.
8. Complete synthetic acceptance for intake, search, documents, clinical notes, PDFs, billing, audit/maintenance, responsive layouts and installation. Record operator and owner sign off.

## 10. Blockers before the first real patient

Owner inputs and approvals, dedicated project provisioning, hosted Auth/security controls, unique encryption material and recovery, tested SMTP/cron, approved break glass notification/review and complete hosted/device acceptance are still required. There is no local migration or test failure outstanding. The baseline must not be represented as a provisioned or accepted production practice.

The [residual value inventory](evidence/practice-value-inventory.json) contains 188 references, including eight legacy binary assets. Each is classified and its treatment explained in the practice value audit. Historical DTM migrations are intentionally retained; fresh bootstrap replaces their practice reference data before the new application is exposed.
