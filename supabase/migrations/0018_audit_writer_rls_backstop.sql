-- Backstop migration: ensure audit_writer can append through RLS.
-- Some environments showed `write_audit_entry` failing with:
--   new row violates row-level security policy for table "audit_logs"
-- even though direct INSERT remains revoked from app roles.

begin;

-- Ensure role privileges expected by SECURITY DEFINER function owner.
grant select, insert on table public.audit_logs to audit_writer;

-- Idempotent policy recreation in case previous migration was missed/drifted.
drop policy if exists audit_logs_writer_insert on public.audit_logs;
create policy audit_logs_writer_insert on public.audit_logs
for insert
to audit_writer
with check (true);

commit;
