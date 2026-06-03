-- 0028_clinical_notes_ink_png.sql
--
-- Phase 5: durable rasterised image of a handwritten note.
--
-- Adds an encrypted PNG (+ its own GCM nonce) alongside the stroke payload.
-- The app rasterises the strokes to PNG client-side; the finalise route encrypts
-- it with the same patient DEK and writes it in the SAME update that sets
-- is_finalised. Migration 0027 makes finalised rows immutable, so the durable
-- image must be captured AT finalisation -- it can never be backfilled onto an
-- already-finalised note.
--
-- The 0027 finalisation-lock trigger does not inspect these columns, so setting
-- them during the draft->finalised transition is permitted; once finalised, the
-- whole row (these columns included) is immutable.
--
-- Apply on staging first where possible. Safe to retry.

begin;

alter table clinical_notes
  add column if not exists encrypted_ink_png bytea,
  add column if not exists ink_png_nonce bytea;

-- Guard the constraint so a partial/retried apply stays safe.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinical_notes'::regclass
      and conname = 'clinical_notes_ink_png_nonce_paired'
  ) then
    alter table clinical_notes
      add constraint clinical_notes_ink_png_nonce_paired
      check (
        (encrypted_ink_png is null and ink_png_nonce is null)
        or (encrypted_ink_png is not null and ink_png_nonce is not null)
      );
  end if;
end $$;

comment on column clinical_notes.encrypted_ink_png is
  'AES-256-GCM ciphertext of the rasterised PNG of the handwritten note, '
  'encrypted app-side with the patient DEK (dek_id). Written at finalisation; '
  'NULL otherwise.';
comment on column clinical_notes.ink_png_nonce is
  '12-byte GCM nonce for encrypted_ink_png. NULL iff encrypted_ink_png is NULL '
  '(enforced by clinical_notes_ink_png_nonce_paired).';

commit;

-- Refresh the PostgREST schema cache so the new columns are exposed immediately.
notify pgrst, 'reload schema';

-- POST-APPLY VERIFICATION:
--   1. Columns encrypted_ink_png + ink_png_nonce exist on clinical_notes.
--   2. With FEATURE_HANDWRITTEN_NOTES_FINALISE=true, finalising a handwritten
--      draft via the real route stores both columns and locks the row.
--   3. Finalising a handwritten note WITHOUT a PNG is rejected (app-level guard).
--   4. The clinical-notes PDF (FEATURE_HANDWRITTEN_NOTES_PDF=true) embeds the
--      decrypted PNG for finalised handwritten notes.
--
-- MANUAL ROLLBACK (safe only before any finalised ink note stores a PNG):
--   begin;
--   alter table clinical_notes drop constraint if exists clinical_notes_ink_png_nonce_paired;
--   alter table clinical_notes drop column if exists ink_png_nonce;
--   alter table clinical_notes drop column if exists encrypted_ink_png;
--   commit;
