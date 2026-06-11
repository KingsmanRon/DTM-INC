> **SUPERSEDED (2026-06-11):** feature is LIVE in prod (0027/0028 applied, all flags on). Kept for history; see docs/internal/v2-fix-plan.md.

# Handwritten clinical notes — rollout & verification checklist

> **"main" (prod deploy branch) is `claude/patient-onboarding-pwa-PFlAh`.**
> Phase 5 code is on `claude/epic-heisenberg-YhRhF` and is PR'd into that branch.

## Where things stand
- [x] Migration `0027` applied to prod — ink columns, content/pairing CHECKs, and the
      finalisation-lock trigger are **LIVE**. The lock governs **every** clinical-note
      update/delete now (typed or handwritten), not just ink.
- [x] Capture + view code merged to main (PR #101).
- [ ] Phase 5 code (finalise + durable PNG + PDF) — on `claude/epic-heisenberg-YhRhF`, not yet merged.
- Flags in prod: `FEATURE_HANDWRITTEN_NOTES`, `_FINALISE`, `_PDF` all `false`.

---

## Stage 1 — confirm `0027` didn't disturb existing notes (do once, now)
The lock is live for all notes, so verify current flows first.
- [ ] A doctor opens a patient → **Clinical Notes tab loads** and shows existing typed notes.
      (This read selects the new ink columns; a 503 here means `0027` didn't apply cleanly.)
- [ ] Finalise a typed draft → succeeds; double-tap Finalise → no-op, **not** a 500.
- [ ] Amend a typed note → original locks, new note links.
- [ ] Staff and admin → see **zero** clinical notes.
- [ ] Run the schema check (Appendix A) — all green.

## Stage 2 — enable capture + view (needs only `0027`, already applied)
- [ ] Get the doctor UUID(s) — Appendix B.
- [ ] Vercel **prod** env: `FEATURE_HANDWRITTEN_NOTES=true`,
      `FEATURE_HANDWRITTEN_NOTES_DOCTOR_IDS=<uuid[,uuid…]>`; keep `_FINALISE=false`, `_PDF=false`.
- [ ] **Redeploy** (env applies only on a new deployment).
- [ ] On the iPad (Safari), as an allowlisted doctor: open a patient → Clinical Notes →
      **Add handwriting** → draw with the Pencil → **Done** → **Save note**.
- [ ] Reopen the patient → the handwriting renders back.
- [ ] Oversized ink → rejected (413); >20 pages → blocked.
- [ ] A non-allowlisted user → **no** "Add handwriting" button.
- [ ] Staff/admin → still no clinical notes at all.

## Stage 3 — ship Phase 5 code (still dormant after this)
- [ ] Open a PR: `claude/epic-heisenberg-YhRhF` → `claude/patient-onboarding-pwa-PFlAh`.
- [ ] CI (Release Gate: lint, typecheck, test, build) green.
- [ ] Merge + deploy. Nothing changes yet — `_FINALISE`/`_PDF` are off and `0028` isn't applied.

## Stage 4 — enable finalise + durable PNG + PDF (needs migration `0028`)
**Order matters — apply `0028` BEFORE flipping the flags**, or the finalise/PDF routes 500 on the missing columns.
- [ ] Apply `0028_clinical_notes_ink_png.sql` to prod.
- [ ] Verify `0028` schema — Appendix C.
- [ ] Vercel prod env: `FEATURE_HANDWRITTEN_NOTES_FINALISE=true`,
      `FEATURE_HANDWRITTEN_NOTES_PDF=true`. **Redeploy.**
- [ ] Finalise a **test** handwritten note → it locks (Finalised badge) and stores the PNG.
- [ ] Confirm the finalised note is immutable (no edit; Amend isn't offered for ink).
- [ ] **Export notes PDF** → handwriting appears as an image, typed notes as text, and any
      still-draft handwriting shows the "finalise to include" placeholder.
- [ ] Multi-page handwriting in the PDF looks acceptable (one stacked image scaled to page
      width — tune the PDF layout if a real multi-page note looks off).

> ⚠️ **One-way door:** once a doctor finalises a handwritten note in prod, `0027` makes that
> row permanently immutable. Confirm the rasterised image looks right (Stage 4 test) **before**
> finalising any real patient's handwriting.

## Rollback levers
- Capture / finalise / PDF are independent env flags — set any back to `false` + redeploy to
  disable instantly (no DB change required).
- `0028` rollback SQL (safe only before any finalised ink note has stored a PNG) is in that
  migration's footer; `0027` rollback SQL (safe only before any ink-only row exists) is in its footer.

---

## Appendix A — verify `0027` landed
```sql
-- columns + nullability  (expect: encrypted_body YES, encrypted_ink YES, ink_nonce YES, nonce YES)
select column_name, is_nullable from information_schema.columns
where table_name='clinical_notes'
  and column_name in ('encrypted_body','nonce','encrypted_ink','ink_nonce') order by 1;

-- CHECK constraints + the lock trigger
select conname from pg_constraint where conrelid='public.clinical_notes'::regclass
  and conname like 'clinical_notes_%' order by 1;     -- has_content, body_nonce_paired, ink_nonce_paired
select tgname from pg_trigger where tgrelid='public.clinical_notes'::regclass
  and not tgisinternal order by 1;                    -- enforce_doctor + prevent_finalised...mutation

-- RLS unchanged
select relrowsecurity as rls_on from pg_class where oid='public.clinical_notes'::regclass;  -- true
select policyname from pg_policies where tablename='clinical_notes';                          -- clinical_notes_doctor_only

-- data sanity (expect 0, 0, 0; ink_rows stays 0 until capture is enabled)
select
  count(*) filter (where (encrypted_body is null) <> (nonce is null))     as body_nonce_mismatch,
  count(*) filter (where (encrypted_ink  is null) <> (ink_nonce is null)) as ink_nonce_mismatch,
  count(*) filter (where encrypted_ink is not null)                       as ink_rows
from clinical_notes;
```

## Appendix B — doctor UUIDs (for `FEATURE_HANDWRITTEN_NOTES_DOCTOR_IDS`)
```sql
-- list doctors and pick the id(s)
select u.* from app_users u join roles r on r.id = u.role_id where r.name = 'doctor';

-- OR get every doctor id pre-joined, ready to paste (enables ALL doctors)
select string_agg(u.id::text, ',') as doctor_ids
from app_users u join roles r on r.id = u.role_id where r.name = 'doctor';
```
Multiple doctors → comma-separated in the single value, e.g. `uuid1,uuid2,uuid3`
(spaces after commas are fine; use the exact lowercase UUIDs; match is case-sensitive).

## Appendix C — verify `0028` landed
```sql
-- both columns present, both nullable
select column_name, is_nullable from information_schema.columns
where table_name='clinical_notes'
  and column_name in ('encrypted_ink_png','ink_png_nonce') order by 1;

-- the paired CHECK
select conname from pg_constraint where conrelid='public.clinical_notes'::regclass
  and conname='clinical_notes_ink_png_nonce_paired';   -- 1 row
```

## Env var reference
| Var | Effect | Needs |
|---|---|---|
| `FEATURE_HANDWRITTEN_NOTES` | Show the handwriting canvas (capture + view) | `0027` |
| `FEATURE_HANDWRITTEN_NOTES_DOCTOR_IDS` | Per-doctor allowlist (comma-separated UUIDs) | — |
| `FEATURE_HANDWRITTEN_NOTES_FINALISE` | Allow locking handwritten notes (captures durable PNG) | `0028` |
| `FEATURE_HANDWRITTEN_NOTES_PDF` | Clinical-notes PDF export (embeds the PNG) | `0028` |

> Every env change requires a **redeploy** to take effect.
