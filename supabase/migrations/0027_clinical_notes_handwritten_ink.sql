-- Purpose: allow a clinical note to carry handwritten stylus ink in addition
-- to, or instead of, a typed body. Ink stays on the EXISTING clinical_notes
-- row, inheriting its doctor-only RLS, doctor-author trigger, patient DEK, and
-- finalisation/amendment model. This migration adds no child table and changes
-- no RLS policy.
--
-- Encryption is performed app-side with the same patient DEK path as typed
-- notes. The encrypted_ink blob contains the serialized multi-page ink JSON;
-- ink_nonce is its separate 12-byte AES-256-GCM nonce.
--
-- Apply on staging first. Nullable encrypted_body and nonce require null-safe
-- decrypt handling in every read path in the same release.

begin;

-- Storage additions and typed-body relaxation are safe to retry.
alter table clinical_notes
  add column if not exists encrypted_ink bytea,
  add column if not exists ink_nonce bytea;

alter table clinical_notes alter column encrypted_body drop not null;
alter table clinical_notes alter column nonce drop not null;

-- Clean up names used by the pre-review draft if it reached a staging
-- database. The replacement constraints below are equivalent and guarded.
alter table clinical_notes
  drop constraint if exists clinical_notes_body_pair,
  drop constraint if exists clinical_notes_ink_pair;

-- Integrity constraints validate existing rows during apply. Existing typed
-- rows satisfy all three checks. Guard each constraint so a partial/retried
-- migration apply remains safe.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinical_notes'::regclass
      and conname = 'clinical_notes_has_content'
  ) then
    alter table clinical_notes
      add constraint clinical_notes_has_content
      check (encrypted_body is not null or encrypted_ink is not null);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinical_notes'::regclass
      and conname = 'clinical_notes_body_nonce_paired'
  ) then
    alter table clinical_notes
      add constraint clinical_notes_body_nonce_paired
      check (
        (encrypted_body is null and nonce is null)
        or (encrypted_body is not null and nonce is not null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinical_notes'::regclass
      and conname = 'clinical_notes_ink_nonce_paired'
  ) then
    alter table clinical_notes
      add constraint clinical_notes_ink_nonce_paired
      check (
        (encrypted_ink is null and ink_nonce is null)
        or (encrypted_ink is not null and ink_nonce is not null)
      );
  end if;
end $$;

-- Tamper-evidence lock. The function only inspects OLD/NEW and intentionally
-- pins an empty search_path. PT409 makes blocked PostgREST mutations surface as
-- HTTP 409 rather than generic 500 errors.
--
-- Rules:
--   * DELETE of a finalised note is blocked (supersede via amendment).
--   * draft -> finalised is allowed only as a narrow metadata transition.
--   * any mutation of an already-finalised note is blocked.
--   * edits to a still-draft note remain allowed.
create or replace function prevent_finalised_clinical_note_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_finalised then
      raise exception 'clinical_notes %: finalised notes cannot be deleted (supersede via amendment)', old.id
        using errcode = 'PT409';
    end if;
    return old;
  end if;

  if old.is_finalised = false and new.is_finalised = true then
    if new.encrypted_body is distinct from old.encrypted_body
       or new.nonce is distinct from old.nonce
       or new.encrypted_ink is distinct from old.encrypted_ink
       or new.ink_nonce is distinct from old.ink_nonce
       or new.dek_id is distinct from old.dek_id
       or new.patient_id is distinct from old.patient_id
       or new.author_user_id is distinct from old.author_user_id
       or new.note_date is distinct from old.note_date
       or new.amended_from_note_id is distinct from old.amended_from_note_id
       or new.created_at is distinct from old.created_at then
      raise exception 'clinical_notes %: content or identity cannot be modified while finalising', old.id
        using errcode = 'PT409';
    end if;
    return new;
  end if;

  if old.is_finalised then
    raise exception 'clinical_notes %: finalised notes are immutable (create an amendment instead)', old.id
      using errcode = 'PT409';
  end if;

  return new;
end;
$$;

-- Remove the pre-review draft trigger/function names if a staging retry is
-- upgrading that draft rather than applying this migration from scratch.
drop trigger if exists clinical_notes_prevent_finalised_changes on clinical_notes;
drop function if exists prevent_finalised_clinical_note_changes();

drop trigger if exists trg_prevent_finalised_clinical_note_mutation on clinical_notes;
create trigger trg_prevent_finalised_clinical_note_mutation
  before update or delete on clinical_notes
  for each row
  execute function prevent_finalised_clinical_note_mutation();

commit;

-- PostgREST caches the exposed schema. Refresh after commit so the new columns
-- are available immediately; harmless when the migration runner also reloads.
notify pgrst, 'reload schema';

-- POST-APPLY VERIFICATION ON STAGING:
--   1. Insert pure-ink note with matching ink_nonce                 -> succeeds.
--   2. Insert note with neither body nor ink                        -> rejected.
--   3. Insert ink without ink_nonce                                 -> rejected.
--   4. Call the REAL typed-note finalise route                      -> succeeds.
--   5. Call the REAL typed-note amend route                         -> succeeds.
--   6. Update content/date/amend-link/created_at of finalised note  -> rejected 409.
--   7. Delete a finalised note                                      -> rejected 409.
--   8. Ordinary staff/admin SELECT clinical_notes                   -> zero rows.
--
-- Operational note: the existing non-production hard_delete_patient_data
-- helper intentionally cannot remove a patient once that patient has a
-- finalised note. Do not add a trigger bypass: use disposable test patients or
-- clean drafts before finalising in E2E fixtures.
--
-- MANUAL ROLLBACK (safe only when no ink-only rows exist):
--   begin;
--   drop trigger if exists trg_prevent_finalised_clinical_note_mutation on clinical_notes;
--   drop function if exists prevent_finalised_clinical_note_mutation();
--   alter table clinical_notes
--     drop constraint if exists clinical_notes_ink_nonce_paired,
--     drop constraint if exists clinical_notes_body_nonce_paired,
--     drop constraint if exists clinical_notes_has_content;
--   alter table clinical_notes
--     drop column if exists ink_nonce,
--     drop column if exists encrypted_ink;
--   -- HAZARD: re-adding NOT NULL fails if any ink-only row exists.
--   -- select count(*) from clinical_notes where encrypted_body is null; -- must be 0
--   -- alter table clinical_notes alter column encrypted_body set not null;
--   -- alter table clinical_notes alter column nonce set not null;
--   commit;
