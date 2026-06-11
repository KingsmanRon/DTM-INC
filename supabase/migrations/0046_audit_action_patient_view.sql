-- 0046_audit_action_patient_view.sql — audit demographic profile reads.
--
-- note_read and document_view are audited; opening a patient's demographic
-- profile was not. POPIA access-logging for special personal information should
-- cover the demographics bundle too. Type-ahead search is deliberately NOT
-- audited (per-keystroke volume, masked identifiers) — the profile open is the
-- meaningful access event.
--
-- Isolated file: ALTER TYPE ... ADD VALUE follows the 0005 convention of
-- keeping enum additions in their own migration, separate from first use.

alter type public.audit_action add value if not exists 'patient_view';
