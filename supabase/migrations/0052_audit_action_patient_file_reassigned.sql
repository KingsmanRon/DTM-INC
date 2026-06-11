-- 0052_audit_action_patient_file_reassigned.sql
--
-- Dedicated audit action for hospital/file-number reassignment (0053): a rare,
-- high-impact correction that must be findable in the audit log on its own,
-- not buried under generic patient_update rows.
--
-- Isolated file per the 0005/0046 convention (enum additions separate from
-- first use).

alter type public.audit_action add value if not exists 'patient_file_reassigned';
