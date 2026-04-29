-- audit_logs has RLS enabled (0002) and only SELECT policies. Without an
-- INSERT policy, every call to write_audit_entry() fails with
--   new row violates row-level security policy for table "audit_logs"
-- because the SECURITY DEFINER function runs as audit_writer, which is not
-- the table owner — RLS therefore applies to it.
--
-- The function itself enforces every audit-chain invariant (advisory lock,
-- prev_hash check, hash recomputation), so a permissive `with check (true)`
-- on this role is correct: all writes already pass through the function,
-- and audit_writer cannot execute arbitrary SQL outside it (no login, no
-- inherit, no execute on anything else).

drop policy if exists audit_logs_writer_insert on audit_logs;

create policy audit_logs_writer_insert on audit_logs
  for insert to audit_writer
  with check (true); 
