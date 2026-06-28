# Patient document image-compression backfill — operator runbook

Safe, resumable backfill that compresses **existing** patient-document images to
WebP. These are POPIA / SA records-retention medical documents, not photos —
correctness, legibility and non-destruction of originals come before storage
savings. Read the design-decision block in the spec before changing any default.

## What ships

| Piece | Path |
| --- | --- |
| Migration (additive tracking columns + helper functions) | `supabase/migrations/0055_patient_documents_compression_tracking.sql` |
| Backfill CLI | `scripts/compress_patient_documents.ts` (`npm run docs:compress`) |
| Rollback CLI | `scripts/rollback_patient_document_compression.ts` (`npm run docs:compress:rollback`) |
| Original-cleanup CLI (archive default / hard-delete guarded) | `scripts/cleanup_patient_document_originals.ts` (`npm run docs:compress:cleanup`) |
| Shared library + unit tests | `scripts/lib/patient-doc-compression.ts` (+ `.test.ts`) |

Env required by every script (server-side only; never logged):
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Output format / policy (why these defaults)

- **WebP, not JPEG** — WebP handles high-contrast text edges far better at the
  same byte size; lossless WebP frequently beats a source PNG. `image/webp` is
  already on the bucket allow-list (migration 0037).
- **Text-critical categories** (`id_copy`, `pathology_result`) get WebP
  near-lossless (lossless if it is not larger than the original, else
  near-lossless quality 90) and are **exempt from the aggressive downscale retry
  tier**. No automated quality loop ever decides whether a digit is readable.
- **Default categories**: WebP lossy q82, effort 6, longest side ≤ 2200 px,
  never upscaled, EXIF orientation baked in first. Retry tier (q78 / 1800 px)
  only if the first pass is still > 5 MB. If the result is not smaller than the
  original → `skipped`, no swap.

## Run order

1. **Apply the migration** (additive `ALTER ... ADD COLUMN IF NOT EXISTS`; never
   recreate `patient_documents`). Apply via the Supabase CLI / `psql` with a
   human in the loop, as the other migrations are.

2. **Dry-run** (default — runs the real sharp compression in memory, writes
   nothing, reports true sizes):
   ```
   npm run docs:compress
   ```

3. **Canary** — 5–10 documents across `id_copy`, `medical_aid_card`,
   `referral_letter`, `pathology_result`, `correspondence`:
   ```
   npm run docs:compress -- --apply --canary
   ```
   **Human gate (spec §7):** open each compressed canary document in the
   frontend and confirm it renders (WebP supported), is legible, and every
   digit/letter is unambiguous. Record sign-off. **Do not run the full batch
   until this is confirmed.**

4. **Full apply** (resumable; safe to run multiple processes concurrently — the
   row lease + guarded swap make it clobber-safe):
   ```
   npm run docs:compress -- --apply
   ```
   The run prints the §11 reconciliation block at the end.

## Verification — §11 acceptance checks

The `--apply` run prints these automatically (row counts before/after, archived
count unchanged, compressed-rows-with-NULL-original = 0, status histogram, and
"storage deletes performed: 0"). Independently in SQL:

```sql
-- §11.3 originals preserved for every compressed row (must be 0)
select count(*) from public.patient_documents
where compression_status = 'compressed' and original_storage_key is null;

-- §11.6 no ambiguous residue after a completed run
select compression_status, count(*) from public.patient_documents group by 1;
```

A second full run must process 0 new rows (§11.8) — all rows are terminal
(`compressed` / `skipped`).

## Rollback (spec §8)

```
npm run docs:compress:rollback                 # dry-run
npm run docs:compress:rollback -- --apply      # reverse swaps to originals
```
Confirms the original object still exists before flipping back; guarded UPDATE;
**never deletes originals**. Pass `--delete-compressed` to also remove the
compressed copy (default keeps it for diagnosis).

## Original cleanup (spec §9) — archive by default

```
npm run docs:compress:cleanup -- --apply       # cold-archive originals
```
Moves each original to `archive/originals/...` and repoints
`original_storage_key` so rollback still resolves.

Hard-delete is a distinct, guarded command and may conflict with SA
records-retention obligations:
```
npm run docs:compress:cleanup -- --apply --hard-delete \
  --i-understand-this-is-irreversible --verification-confirmed \
  --operator "Name" [--retention-days 30]
```
Deletes an original only when: status `compressed`, `compressed_at` older than
the retention window (default 30 days, min 14), frontend verification attested
(`--verification-confirmed` + `--operator`), and the compressed object currently
re-fetches and decodes. Orphan-object cleanup is out of scope.
