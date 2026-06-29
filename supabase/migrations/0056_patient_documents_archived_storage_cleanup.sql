-- 0056_patient_documents_archived_storage_cleanup.sql — additive tracking for
-- archived patient document storage-object cleanup.
--
-- Rows are retained for audit/history; only the corresponding Supabase Storage
-- object may be removed by scripts/cleanup_archived_patient_document_files.ts.
-- This migration is intentionally additive and re-runnable.

alter table public.patient_documents
  add column if not exists storage_object_deleted_at timestamptz,
  add column if not exists storage_object_deleted_by text,
  add column if not exists storage_object_delete_reason text;
