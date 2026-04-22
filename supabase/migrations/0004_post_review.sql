-- 0004_post_review.sql — post-review additions. ADDITIVE ONLY.
-- Safe to apply after 0001–0003, but MUST be applied BEFORE deploying the
-- code that references `access_denied`, `active_patients`, or the partial index.

set statement_timeout = 0;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Partial index on archived_at
--    Keeps active-patient search fast as the archive grows. Partial so it
--    stays small (most rows are archived_at IS NULL).
-- ═══════════════════════════════════════════════════════════════════════════

create index if not exists patients_archived_at_idx
  on patients (archived_at)
  where archived_at is not null;

-- NOTE: The audit_action enum additions ('access_denied', 'patient_unarchive')
-- live in 0005_audit_action_values.sql — ALTER TYPE ADD VALUE cannot share a
-- transaction with the enum's subsequent use on PG < 15, so they are isolated
-- in their own migration file.

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. active_patients view
--    One definition instead of fifty call sites filtering `archived_at IS NULL`.
--    `security_invoker` (Postgres 15+) makes the view run with the caller's
--    privileges so RLS still gates row visibility.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace view active_patients
  with (security_invoker = true)
  as select * from patients where archived_at is null;

grant select on active_patients to authenticated;
