-- 0023_audit_outbox_drain_hardening.sql
--
-- Incident: database-CPU exhaustion. The audit outbox was drained
-- opportunistically from request handlers; on serverless that fanned out
-- service_role REST calls from every instance (module-level rate-limiting
-- resets on each cold start) and a stuck outbox turned a transient audit
-- outage into ~80M REST round-trips. This migration supports the fix:
--
--   1. dead_lettered_at — events that keep failing stop being retried forever.
--   2. audit_maintenance_locks + try_acquire/release RPCs — a DB-backed lease
--      so at most one outbox drain runs across all serverless instances
--      (the in-app guard cannot, because module state is per-instance).
--   3. Re-assert the write_audit_entry path so the synchronous write succeeds
--      and the outbox stays empty under normal operation.
--
-- Idempotent: safe to re-run.

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Dead-letter support for the audit outbox.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.audit_log_outbox
  add column if not exists dead_lettered_at timestamptz;

-- Partial index over the rows a drain actually scans: unprocessed, not
-- dead-lettered, ordered by availability/creation. Keeps the drain query cheap
-- as the outbox grows.
create index if not exists audit_log_outbox_drainable_idx
  on public.audit_log_outbox (available_at, created_at)
  where processed_at is null and dead_lettered_at is null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Cross-instance maintenance lock (lease).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.audit_maintenance_locks (
  name         text primary key,
  locked_until timestamptz
);

insert into public.audit_maintenance_locks (name, locked_until)
  values ('outbox_drain', null)
  on conflict (name) do nothing;

-- RLS: this table is only ever touched by the SECURITY DEFINER functions below
-- and (defensively) by service_role. No app role gets direct access.
alter table public.audit_maintenance_locks enable row level security;

-- try_acquire_maintenance_lock: atomically take a TTL-bounded lease. Returns
-- true only if no live lease exists. The single UPDATE is the atomic primitive
-- that serialises concurrent drains across serverless instances. A crashed
-- holder cannot deadlock the system — the lease auto-expires after its TTL.
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
  update public.audit_maintenance_locks
     set locked_until = now() + make_interval(secs => p_ttl_seconds)
   where name = p_name
     and (locked_until is null or locked_until < now())
  returning true into v_acquired;

  return coalesce(v_acquired, false);
end;
$$;

create or replace function public.release_maintenance_lock(p_name text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.audit_maintenance_locks set locked_until = null where name = p_name;
$$;

revoke all on function public.try_acquire_maintenance_lock(text, int) from public;
revoke all on function public.release_maintenance_lock(text) from public;
grant execute on function public.try_acquire_maintenance_lock(text, int) to service_role;
grant execute on function public.release_maintenance_lock(text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Re-assert the write_audit_entry path (idempotent restatement of 0019).
--    If the synchronous write works, the outbox stays empty and the drain has
--    nothing to amplify in the first place.
-- ═══════════════════════════════════════════════════════════════════════════

do $$ begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'write_audit_entry'
  ) then
    execute $cmd$
      alter function public.write_audit_entry(
        text, text, uuid, public.role_name, public.audit_action,
        text, uuid, uuid, jsonb, inet, text, timestamptz
      ) owner to audit_writer
    $cmd$;

    execute $cmd$
      grant execute on function public.write_audit_entry(
        text, text, uuid, public.role_name, public.audit_action,
        text, uuid, uuid, jsonb, inet, text, timestamptz
      ) to service_role
    $cmd$;
  end if;
end $$;

commit;
