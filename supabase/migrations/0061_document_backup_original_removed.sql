-- Originals hard-deleted by the compression clean-up keep original_storage_key
-- while their bytes are gone. The backup now records them as
-- 'original_removed' (not a failure, never retried); the compressed copy is
-- backed up as the document's active object.
begin;

alter table public.patient_document_backups drop constraint if exists patient_document_backups_status_check;
alter table public.patient_document_backups add constraint patient_document_backups_status_check
  check (status in ('backed_up', 'missing_source', 'original_removed', 'hash_mismatch', 'failed'));

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
      or (b.status not in ('backed_up', 'original_removed') and b.attempts < 5)
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
      or (b.status not in ('backed_up', 'original_removed') and b.attempts < 5);
$$;

revoke execute on function public.documents_pending_backup(integer) from public, anon, authenticated;
revoke execute on function public.documents_pending_backup_count() from public, anon, authenticated;
grant execute on function public.documents_pending_backup(integer) to service_role;
grant execute on function public.documents_pending_backup_count() to service_role;

commit;
