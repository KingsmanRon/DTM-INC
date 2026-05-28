-- 0024_audit_lock_non_blocking.sql
--
-- Incident follow-up: the audit drain hung and the database CPU spiked because
-- write_audit_entry took a BLOCKING advisory lock
-- (pg_advisory_xact_lock). When one PostgREST session got stuck holding that
-- lock ("idle in transaction (aborted)"), every other audit writer waited on it
-- forever — the drain hung and real audit writes blocked, piling up connections.
--
-- Fix:
--   1. Use pg_TRY_advisory_xact_lock (non-blocking). If the chain lock is
--      contended/stuck, raise 40001 (serialization_failure) so the Node caller
--      retries and ultimately degrades to the outbox — it NEVER waits. No hang,
--      no connection pile-up, no CPU spike, even if a session is stuck.
--   2. Defensively reap stuck transactions: set idle_in_transaction_session_
--      timeout so an aborted/idle transaction can no longer hold the lock
--      indefinitely. (Only the lock holder needs reaping; normal audit writes
--      are never idle in a transaction.)
--
-- Idempotent: create or replace + ALTER ... SET.

begin;

create or replace function public.write_audit_entry(
  p_expected_prev_hash text,
  p_entry_hash         text,
  p_actor_user_id      uuid,
  p_actor_role         public.role_name,
  p_action             public.audit_action,
  p_entity_type        text,
  p_entity_id          uuid,
  p_patient_id         uuid,
  p_metadata_json      jsonb,
  p_ip_address         inet,
  p_user_agent         text,
  p_created_at         timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tail_hash text;
  v_new_id    uuid;
begin
  -- Non-blocking: never wait on a stuck/aborted session that holds the chain
  -- lock. If we cannot take it immediately, raise 40001 so the caller retries
  -- (and falls back to the outbox) instead of hanging.
  if not pg_try_advisory_xact_lock(hashtext('dtm_audit_chain')) then
    raise exception 'audit chain lock busy' using errcode = '40001';
  end if;

  select entry_hash into v_tail_hash
    from public.audit_logs
    order by created_at desc, id desc
    limit 1;

  if coalesce(v_tail_hash, '') is distinct from coalesce(p_expected_prev_hash, '') then
    raise exception 'audit chain tail moved: expected=%, actual=%',
      coalesce(p_expected_prev_hash, '<null>'),
      coalesce(v_tail_hash, '<null>')
      using errcode = '40001';
  end if;

  insert into public.audit_logs (
    actor_user_id, actor_role, action, entity_type, entity_id,
    patient_id, metadata_json, ip_address, user_agent,
    created_at, prev_hash, entry_hash
  ) values (
    p_actor_user_id, p_actor_role, p_action, p_entity_type, p_entity_id,
    p_patient_id, coalesce(p_metadata_json, '{}'::jsonb), p_ip_address, p_user_agent,
    p_created_at, p_expected_prev_hash, p_entry_hash
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

-- Keep the ownership/execute model explicit and idempotent (matches 0019).
alter function public.write_audit_entry(
  text, text, uuid, public.role_name, public.audit_action,
  text, uuid, uuid, jsonb, inet, text, timestamptz
) owner to audit_writer;

revoke all on function public.write_audit_entry(
  text, text, uuid, public.role_name, public.audit_action,
  text, uuid, uuid, jsonb, inet, text, timestamptz
) from public;
grant execute on function public.write_audit_entry(
  text, text, uuid, public.role_name, public.audit_action,
  text, uuid, uuid, jsonb, inet, text, timestamptz
) to service_role;

-- Defensive backstop: reap transactions left idle (incl. aborted) so a stuck
-- session can no longer hold the advisory lock forever. Applies to NEW
-- connections. 60s is well above any legitimate audit write.
do $$
begin
  execute format(
    'alter database %I set idle_in_transaction_session_timeout = %L',
    current_database(), '60s'
  );
end $$;

commit;
