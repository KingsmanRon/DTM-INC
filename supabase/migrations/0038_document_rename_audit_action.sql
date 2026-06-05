-- 0038_document_rename_audit_action.sql — enum value addition, isolated.
--
-- Like 0005 and 0035: ALTER TYPE ... ADD VALUE cannot share a transaction with
-- statements that subsequently use the new value (PostgreSQL < 15), and
-- Supabase wraps each migration file in a transaction. So this value lives
-- alone and is USED only at runtime via write_audit_entry_atomic.
--
-- Backs the POPIA accountability trail for renaming a patient document's
-- display name (original_filename). The storage object is never moved — only
-- the human-facing label changes.
--
-- Apply BEFORE deploying the rename endpoint (PATCH
-- /api/v1/patients/[id]/documents/[docId]) that emits this action, or the audit
-- write will fail enum validation and degrade to the outbox.

alter type audit_action add value if not exists 'document_rename';
