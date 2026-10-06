-- Off-site document backup ledger (S3, see src/lib/backup/documents.ts).
--
-- One row per stored object (active upload or retained original) records
-- whether it has been copied to the backup target. It is the evidence the
-- restore drill reconciles against. Service role only: no client access.
begin;

create table if not exists public.patient_document_backups (
  storage_key    text primary key,
  document_id    uuid not null,
  object_kind    text not null check (object_kind in ('active', 'original')),
  sha256_hash    text not null,
  status         text not null check (status in ('backed_up', 'missing_source', 'hash_mismatch', 'failed')),
  s3_key         text,
  s3_version_id  text,
  attempts       integer not null default 0,
  last_error     text,
  backed_up_at   timestamptz,
  updated_at     timestamptz not null default now()
);

comment on table public.patient_document_backups is
  'Off-site backup ledger for patient document objects. Written by the nightly backup job with the service role only.';

create index if not exists patient_document_backups_document_idx on public.patient_document_backups (document_id);

alter table public.patient_document_backups enable row level security;
revoke all on table public.patient_document_backups from public, anon, authenticated;
grant select, insert, update on table public.patient_document_backups to service_role;

-- Objects not yet backed up. Failed objects are retried up to five times;
-- archived objects whose bytes were deliberately removed are skipped.
create or replace function public.documents_pending_backup(p_limit integer default 50)
returns table (
  document_id uuid,
  storage_key text,
  sha256_hash text,
  mime_type   text,
  object_kind text,
  attempts    integer
)
language sql
stable
set search_path = ''
as $$
  with candidates as (
    select d.id, d.storage_key, d.sha256_hash, d.mime_type, 'active'::text as object_kind, d.uploaded_at
      from public.patient_documents d
     where d.storage_object_deleted_at is null
    union all
    select d.id, d.original_storage_key, d.original_sha256_hash, coalesce(d.original_mime_type, d.mime_type), 'original', d.uploaded_at
      from public.patient_documents d
     where d.original_storage_key is not null
       and d.original_sha256_hash is not null
  )
  select c.id, c.storage_key, c.sha256_hash, c.mime_type, c.object_kind, coalesce(b.attempts, 0)
    from candidates c
    left join public.patient_document_backups b on b.storage_key = c.storage_key
   where b.storage_key is null
      or (b.status <> 'backed_up' and b.attempts < 5)
   order by c.uploaded_at, c.storage_key
   limit greatest(1, least(coalesce(p_limit, 50), 1000));
$$;

create or replace function public.documents_pending_backup_count()
returns bigint
language sql
stable
set search_path = ''
as $$
  select count(*)
    from (
      select d.storage_key from public.patient_documents d where d.storage_object_deleted_at is null
      union all
      select d.original_storage_key from public.patient_documents d
       where d.original_storage_key is not null and d.original_sha256_hash is not null
    ) c(storage_key)
    left join public.patient_document_backups b on b.storage_key = c.storage_key
   where b.storage_key is null
      or (b.status <> 'backed_up' and b.attempts < 5);
$$;

revoke execute on function public.documents_pending_backup(integer) from public, anon, authenticated;
revoke execute on function public.documents_pending_backup_count() from public, anon, authenticated;
grant execute on function public.documents_pending_backup(integer) to service_role;
grant execute on function public.documents_pending_backup_count() to service_role;

commit;
