# US Rollout — status & what's left

**Purpose.** This branch (`claude/us-rollout`) is the staging ground for the US
version of the platform. It will be moved into its own repo as `master`. This
file is the kick-off reference: what already works, what's left, and the
decisions/gotchas you'll want in hand. Last updated 2026-06-15.

> The product is single-tenant (one isolated deployment per practice). Today the
> US code lives *beside* the SA code in one repo, gated by a per-practice
> **locale** (`practice_settings.locale` = `za` | `us`, default `za`). Every
> change so far keeps the live SA path byte-identical. **Once this is its own
> repo, the SA branches can be deleted** — see "Post-split cleanup" below.

---

## How to run the US flow today

1. Set the practice to US: `update practice_settings set locale = 'us' where id = 1;`
2. Add at least one facility row to `public.hospitals` (US still uses the
   hospital file-prefix until the MRN slice — see below).
3. Onboard a patient at `/patients/new`: identity is **name + date of birth**
   (no national ID), SSN last-4 optional, and Section C is **Insurance**.

Dev notes: no local Docker here, so migrations/pgTAP are validated by the
**authz-tests CI** (boots Supabase, applies every migration from `0001`, runs
`supabase/tests/authz.test.sql`). `npm run check:functions` keeps
`supabase/functions/*.sql` snapshots in sync with the migrations.

---

## DONE (US works end-to-end for identity + insurance capture)

| Area | What | Where |
|---|---|---|
| Security | MFA enforced at the **API layer** (AAL2 for doctor/admin), not just pages | `fcceb7b` (also live on SA prod as `65407ed`) |
| Locale switch | `PracticeLocale` + `practice_settings.locale` (trusted, server-side) | `bb4788f`, migration `0056` |
| Identity model | No national ID — name + DOB anchor, optional SSN last-4; soft-dup key | `src/lib/validation/us-identity.ts` |
| DB | `id_type 'none'`, `patients.date_of_birth` + `ssn_last4`, widened identity CHECK, **non-unique** US dup index | `0054`, `0055` |
| Onboarding RPC | `onboard_patient` locale-aware (US identity rules; writes DOB/SSN) | `0057` |
| Responsible party | relaxed NOT-NULLs that blocked US (id_number/DOB/marital) | `0058` |
| API | locale-aware payload schema + `patients` POST route (skips SA dup-check for US) | `onboarding-us.ts`, `6076959` |
| Wizard | Section A/B locale UI (US: DOB + SSN, no SA-ID; relaxed guarantor) | `d9ac53e` |
| Insurance capture | `group_number` + `subscriber_relationship` cols; `onboard_patient` v5; `UsSectionC`; wizard "C — Insurance" | `0059`, `0060`, `dcd2ac2` |
| Tests | 4 pgTAP US-onboarding tests; US schema vitest cases (116 total) | `authz.test.sql`, `onboarding-payload.test.ts` |

**Caveat:** the wizard UI has not been exercised in a running US-locale app yet
— it passes `tsc` / lint / `build` / tests, but needs a manual run-through.

---

## LEFT — functional (in rough priority / dependency order)

1. **Superbill / billing handoff** *(core to the value prop, big).* Replace the
   SA per-hospital batch export with a US **superbill**: CPT + ICD-10 (+ modifiers,
   place of service) per encounter. **Decision locked: the provider picks codes
   in-app** (not the RCM coders) — so build a CPT/ICD picker tied to the
   clinical note / encounter, then a superbill export the billing company
   consumes. We never submit claims or touch money.
2. **US search & masking.** Search currently keys off `id_number` (null for US)
   and masks it. Make US patients findable by **name + DOB**; surface DOB instead
   of a masked national ID. Files: `src/app/api/v1/patients/search/route.ts`.
3. **Soft-duplicate warning.** US identity (name+DOB) is *not* unique, so the DB
   has only a non-unique lookup index (`0055`). Build the **warn-and-override**
   UX at onboarding (look up likely matches, let the user confirm). `usIdentityDedupeKey`
   already exists in `us-identity.ts`.
4. **Insurance — finish it.** (a) **270/271 real-time eligibility** at intake via
   a clearinghouse (Availity / Optum / Stedi / Eligible) — **blocked on a real
   clearinghouse account**, can't be built/tested locally; (b) **insurance-card
   images** (front/back) via the existing documents flow — add categories;
   (c) **secondary insurance** (second payer row/fields).
5. **File-number → MRN.** The per-hospital `{PREFIX}-{YYYY}-{SEQ}` scheme is an SA
   assumption. US practices usually have one practice chart number (MRN), not
   per-hospital prefixes. Rethink: practice MRN, with facility/location optional.
   Touches `allocate_file_number`, `onboard_patient`, `reassign_patient_hospital`,
   the hospitals table, and search.
6. **Consent → HIPAA.** Replace POPIA consent cards / privacy notice with
   **Notice of Privacy Practices acknowledgment + consent-to-treat + financial
   responsibility**. `consent_cards` are data (per-practice), but the fallbacks /
   privacy-notice copy in code are POPIA-worded.

---

## LEFT — compliance & ops (the HIPAA gate; mostly not code)

Must be in place **before patient #1** on any real US practice:

- **BAAs**: you become a Business Associate — sign with the practice AND every
  subprocessor (Supabase, Vercel, email, clearinghouse).
- **US hosting region**: Supabase HIPAA/paid tier (it runs on AWS) + Vercel
  Enterprise BAA + US data residency. **Decision locked: no self-managed AWS for
  now** — keep the Supabase/Vercel stack.
- **Breach notification**: HIPAA timeline (≤60 days to individuals + HHS; >500
  records → media + immediate HHS). Replace the POPIA 48h wording.
- **Roles**: Privacy Officer + Security Officer (replace "Information Officer").
- **Risk assessment + annual audit / periodic vuln scans** (2026 HIPAA direction
  makes MFA, encryption-at-rest, audit controls *required* — we already have
  these; document them).

---

## Post-split cleanup (once this is the US repo's master)

The locale machinery exists only because SA and US currently share a repo. In a
US-only repo, simplify:

- Delete the SA (`za`) branches in `onboard_patient`, the API route, and the
  wizard; drop `sa-id.ts` and the SA `SectionA/B/C`.
- Collapse `onboarding-us.ts` into the main schema (no factory); `locale` can be
  hardcoded `us` or removed.
- Rename `patient_medical_aid` (+ reused columns) to insurance semantics; rename
  "hospital" → clinic/facility throughout the UI/data.
- POPIA → HIPAA language sweep (README, comments, privacy notice, SLA).

---

## Decisions locked (2026-06-14/15)

- **Beachhead:** hybrid — greenfield cash-leaning specialists; we make the
  extract, a billing partner handles claims/payments (never us).
- **Eligibility (270/271):** in scope for v1 (read-only; not "billing").
- **Coding:** provider in-app CPT/ICD picker (not RCM coders).
- **Hosting:** Supabase-HIPAA + US region; no AWS re-platform for now.
- **Positioning:** "the EHR that does less, beautifully" — own documentation +
  intake, hand billing off. Not a full-EHR parity war. See
  `docs/business/deck-3-us-rollout.md` (local only — `docs/business/` is
  gitignored, so it will NOT come across in the repo move; copy it manually).

---

## Gotchas

- **`onboard_patient` canonical churn:** running `check-canonical-functions.mjs
  --update` after editing `onboard_patient` also rewrites
  `reassign_patient_hospital.sql` with different line-endings (no content change).
  Revert that file (`git checkout -- supabase/functions/reassign_patient_hospital.sql`)
  and commit only `onboard_patient.sql`.
- **Migrations-before-code** deploy order; additive/nullable only while SA shares
  the repo.
- **`docs/business/` is gitignored** — deck-1/2/3 + the SLA won't travel with a
  `git clone`/repo move. Copy the deck-3 file by hand into the new repo if you
  want it there.
