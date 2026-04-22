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

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. access_denied audit action
--    Emitted by requireRole() when an authenticated user fails the role gate.
--    Without this, the 404-on-forbidden strategy is silent.
-- ═══════════════════════════════════════════════════════════════════════════

alter type audit_action add value if not exists 'access_denied';
alter type audit_action add value if not exists 'patient_unarchive';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. active_patients view
--    One definition instead of fifty call sites filtering `archived_at IS NULL`.
--    `security_invoker` (Postgres 15+) makes the view run with the caller's
--    privileges so RLS still gates row visibility.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace view active_patients
  with (security_invoker = true)
  as select * from patients where archived_at is null;

grant select on active_patients to authenticated;
