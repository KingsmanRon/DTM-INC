-- 0035_billing_export_audit_actions.sql — enum value additions, isolated.
--
-- ALTER TYPE ... ADD VALUE cannot share a transaction with any statement that
-- subsequently uses the new value on PostgreSQL < 15, and Supabase wraps each
-- migration file in a transaction. So — exactly like 0005 — the new
-- audit_action values live alone in their own file and are USED only at
-- runtime (via write_audit_entry_atomic), never inside this migration.
--
-- These back the POPIA disclosure trail for the monthly billing export
-- (§Constraints 1.1 / 5): they are written through the existing SECURITY
-- DEFINER audit function. No trigger is added.
--
-- Apply BEFORE 0036_billing_export_items.sql and BEFORE deploying the billing
-- export code that references these actions.

alter type audit_action add value if not exists 'billing_export_generate';
alter type audit_action add value if not exists 'billing_export_item_update';
alter type audit_action add value if not exists 'billing_export_mark_returned';
