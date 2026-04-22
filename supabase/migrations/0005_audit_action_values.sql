-- 0005_audit_action_values.sql — enum value additions, isolated.
--
-- ALTER TYPE ... ADD VALUE cannot be executed in the same transaction as any
-- statement that subsequently uses the new value on PostgreSQL < 15. Supabase
-- wraps each migration file in a transaction, so these must live alone.
--
-- Apply AFTER 0004 and BEFORE 0006.

alter type audit_action add value if not exists 'access_denied';
alter type audit_action add value if not exists 'patient_unarchive';
