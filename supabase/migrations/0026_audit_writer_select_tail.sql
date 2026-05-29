-- 0026_audit_writer_select_tail.sql
--
-- Root-cause fix for failing audit writes / ever-growing outbox.
--
-- write_audit_entry() is SECURITY DEFINER owned by audit_writer. audit_logs has
-- RLS enabled, but its SELECT policies only cover the `authenticated` roles
-- (doctor/admin). There is NO select policy for audit_writer, so the function's
-- chain-tail read
--     select entry_hash from audit_logs order by created_at desc, id desc limit 1
-- returns NULL under RLS even when rows exist. The caller (service_role, which
-- bypasses RLS) passes the REAL tail as p_expected_prev_hash, the function sees
-- null, and the prev_hash check fails with
--     40001: audit chain tail moved: expected=<real>, actual=<null>
-- for every write after the very first. Result: audit_logs never grows past one
-- row and all subsequent events pile into audit_log_outbox forever.
--
-- Fix: give audit_writer a SELECT policy on audit_logs so the tail check can see
-- the chain. audit_writer is nologin/noinherit and only reachable through the
-- SECURITY DEFINER functions, so `using (true)` exposes nothing new.
--
-- Idempotent.

begin;

drop policy if exists audit_logs_writer_select on public.audit_logs;
create policy audit_logs_writer_select on public.audit_logs
  for select to audit_writer
  using (true);

-- Ensure the table-level SELECT grant is present too (0002 granted it; restate
-- defensively in case it drifted).
grant select on table public.audit_logs to audit_writer;

commit;
