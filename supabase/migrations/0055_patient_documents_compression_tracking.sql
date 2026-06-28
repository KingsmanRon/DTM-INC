-- 0055_patient_documents_compression_tracking.sql — additive tracking columns
-- and concurrency-safe helper functions for the safe, resumable image-
-- compression backfill (see scripts/compress_patient_documents.ts).
--
-- WHY ADDITIVE ONLY: a CREATE TABLE / drop+recreate on patient_documents would
-- silently drop the RLS policies (0002), the table-level grants to
-- `authenticated` (0002) and the on-delete-restrict FKs — the exact
-- `42501 permission denied` class currently being chased on clinical_notes.
-- Every change below is `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` or a new,
-- separately-owned function. Nothing existing is recreated.
--
-- COLUMN-GRANT FINDING (spec §1): grants on public.patient_documents are
-- TABLE-LEVEL — 0002 does `grant select, insert, update on ... patient_documents
-- ... to authenticated`, not column-scoped. New columns are therefore readable
-- by the frontend read role with no extra GRANT. No column-scoped grant is added.

-- ── Tracking columns ────────────────────────────────────────────────────────
alter table public.patient_documents
  add column if not exists original_storage_key  text,
  add column if not exists original_file_size    bigint,
  add column if not exists original_sha256_hash  text,
  add column if not exists original_mime_type    text,   -- needed to faithfully
                                                          -- restore mime on rollback
                                                          -- (§8); not in the spec's
                                                          -- column list but required
                                                          -- for a correct reversal.
  add column if not exists compressed_at         timestamptz,
  add column if not exists compression_status    text not null default 'pending',
  add column if not exists compression_error     text,
  add column if not exists compression_version   text,
  add column if not exists compression_quality   integer,
  add column if not exists compression_format    text;

-- compression_status is an enumerated state machine, not free text. The CHECK
-- constraint is what makes idempotency + crash-recovery reliable: a worker can
-- only ever observe a known state. Added guardedly so the migration is
-- re-runnable.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'patient_documents_compression_status_chk'
      and conrelid = 'public.patient_documents'::regclass
  ) then
    alter table public.patient_documents
      add constraint patient_documents_compression_status_chk
      check (compression_status in (
        'pending',      -- not yet processed
        'in_progress',  -- leased by a worker; slow work happening
        'uploaded',     -- compressed object uploaded, not yet verified
        'verified',     -- round-trip verified, DB swap not yet committed
        'compressed',   -- terminal success: storage_key points at compressed copy
        'skipped',      -- intentionally not compressed (too small / larger / unsupported)
        'failed',       -- error; see compression_error
        'rolled_back'   -- restored to original
      ));
  end if;
end $$;

-- Partial index so the backfill's "find the next batch of work" query stays
-- cheap as the table fills with terminal (compressed/skipped) rows.
create index if not exists patient_documents_compression_pending_idx
  on public.patient_documents (uploaded_at)
  where compression_status in ('pending','failed','in_progress','uploaded','verified');

-- ── Lease a row for compression (concurrency-safe, §4 step 3 / §10) ──────────
-- Claims ONE row by id with FOR UPDATE SKIP LOCKED inside a short transaction
-- (this function call), flips a fresh pending/failed row to in_progress, and
-- returns the current row so the caller can decide fresh-vs-resume. The lock is
-- released the moment this statement commits, so no row lock is ever held
-- across the multi-second download/compress/upload. Returns zero rows when the
-- row is locked by another worker (SKIP LOCKED) — the caller simply moves on.
create or replace function public.lease_patient_document_for_compression(p_id uuid)
returns setof public.patient_documents
language plpgsql
security invoker
as $$
declare
  v_status text;
begin
  select compression_status into v_status
  from public.patient_documents
  where id = p_id
  for update skip locked;

  if not found then
    -- Locked by a concurrent worker, or the row no longer exists.
    return;
  end if;

  -- Only a not-yet-started row transitions to in_progress here. Rows already in
  -- a mid-flight state (in_progress/uploaded/verified) are returned as-is so the
  -- caller resumes from the right step; terminal rows are returned so the caller
  -- can skip without a second query.
  if v_status in ('pending', 'failed') then
    update public.patient_documents
      set compression_status = 'in_progress',
          compression_error  = null
      where id = p_id;
  end if;

  return query select * from public.patient_documents where id = p_id;
end;
$$;

-- ── The guarded, atomic swap (§4 step 7) ────────────────────────────────────
-- A single UPDATE that both performs the storage_key swap AND proves it is not
-- clobbering a concurrent clinician write. COALESCE preserves the original-*
-- columns if a prior (crashed) attempt already populated them. The WHERE clause
-- is the optimistic-concurrency guard: storage_key must still equal what the
-- worker read, and the status must be a swappable one. Returns the number of
-- rows updated — 0 means the row changed underneath us; the caller must NOT
-- retry the clobber.
create or replace function public.swap_patient_document_to_compressed(
  p_id              uuid,
  p_expected_old_key text,
  p_original_hash   text,
  p_original_mime   text,
  p_compressed_path text,
  p_compressed_size bigint,
  p_compressed_hash text,
  p_final_quality   integer
)
returns integer
language plpgsql
security invoker
as $$
declare
  v_count integer;
begin
  update public.patient_documents
  set
    original_storage_key = coalesce(original_storage_key, storage_key),
    original_file_size   = coalesce(original_file_size, file_size),
    original_sha256_hash = coalesce(original_sha256_hash, p_original_hash),
    original_mime_type   = coalesce(original_mime_type, p_original_mime),
    storage_key          = p_compressed_path,
    mime_type            = 'image/webp',
    file_size            = p_compressed_size,
    sha256_hash          = p_compressed_hash,
    compressed_at        = now(),
    compression_status   = 'compressed',
    compression_version  = 'v1',
    compression_quality  = p_final_quality,
    compression_format   = 'webp'
  where id = p_id
    and storage_key = p_expected_old_key                 -- row unchanged since read
    and compression_status in ('verified', 'uploaded', 'in_progress');

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── The guarded rollback (§8) ───────────────────────────────────────────────
-- Reverses a completed swap. Guarded so it only ever fires on a row that is
-- currently 'compressed' AND still points at the exact compressed key the
-- caller verified, AND that has an original recorded to restore to. The caller
-- is responsible for confirming the original object still exists in storage
-- before invoking this. Returns rows-affected (0 == nothing reversed).
create or replace function public.rollback_patient_document_compression(
  p_id                      uuid,
  p_expected_compressed_key text
)
returns integer
language plpgsql
security invoker
as $$
declare
  v_count integer;
begin
  update public.patient_documents
  set
    storage_key        = original_storage_key,
    file_size          = original_file_size,
    sha256_hash        = original_sha256_hash,
    mime_type          = original_mime_type,
    compression_status = 'rolled_back'
  where id = p_id
    and compression_status = 'compressed'
    and storage_key = p_expected_compressed_key
    and original_storage_key is not null
    and original_file_size is not null
    and original_sha256_hash is not null
    and original_mime_type is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── Reconciliation helper (§11 acceptance checks) ───────────────────────────
-- One round-trip status histogram so the backfill's post-run reconciliation
-- ("no rows stuck in ambiguous states") does not require a direct DB session.
create or replace function public.patient_document_compression_status_counts()
returns table (compression_status text, n bigint)
language sql
stable
security invoker
as $$
  select pd.compression_status, count(*)::bigint
  from public.patient_documents pd
  group by pd.compression_status
  order by pd.compression_status;
$$;

-- These functions are operator/backfill tooling, driven by the service-role
-- key only — never by the `authenticated` frontend role.
grant execute on function public.lease_patient_document_for_compression(uuid)            to service_role;
grant execute on function public.swap_patient_document_to_compressed(uuid, text, text, text, text, bigint, text, integer) to service_role;
grant execute on function public.rollback_patient_document_compression(uuid, text)       to service_role;
grant execute on function public.patient_document_compression_status_counts()            to service_role;
