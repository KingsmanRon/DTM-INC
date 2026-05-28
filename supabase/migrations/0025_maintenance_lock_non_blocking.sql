-- 0025_maintenance_lock_non_blocking.sql
--
-- Follow-up to 0024. The outbox drain acquires its lease by UPDATE-ing a single
-- hot row in audit_maintenance_locks. If any transaction is left wedged
-- ("idle in transaction") holding that row lock, every subsequent drain's
-- lease UPDATE blocks forever -> the drain hangs before it ever reaches the
-- (now non-blocking) write path.
--
-- Fix: bound the lease UPDATE with a short lock_timeout. If the row is locked,
-- fail fast (treat as "lease not acquired") instead of waiting. A drain can
-- then never hang; at worst it skips this run and tries again next schedule.
--
-- Idempotent: create or replace.

begin;

create or replace function public.try_acquire_maintenance_lock(
  p_name text,
  p_ttl_seconds int
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acquired boolean := false;
begin
  -- Never wait on a wedged transaction holding this row: fail fast.
  set local lock_timeout = '2s';

  update public.audit_maintenance_locks
     set locked_until = now() + make_interval(secs => p_ttl_seconds)
   where name = p_name
     and (locked_until is null or locked_until < now())
  returning true into v_acquired;

  return coalesce(v_acquired, false);
exception
  when lock_not_available then
    -- Row is locked by another (possibly stuck) session — skip this run.
    return false;
end;
$$;

revoke all on function public.try_acquire_maintenance_lock(text, int) from public;
grant execute on function public.try_acquire_maintenance_lock(text, int) to service_role;

commit;
