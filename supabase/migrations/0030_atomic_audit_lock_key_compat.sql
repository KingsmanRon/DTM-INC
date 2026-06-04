-- 0030_atomic_audit_lock_key_compat.sql
--
-- Drafted for review; do not apply automatically.
--
-- 0029 introduced write_audit_entry_atomic with the requested single-RPC audit
-- write path, but used a different advisory-lock key from the legacy
-- write_audit_entry function. During Vercel rolling deploys or outbox replay,
-- old and new code paths can briefly coexist. Both writer functions must take
-- the SAME transaction-scoped advisory lock before reading/inserting the hash
-- chain tail, otherwise mixed old/new writers could serialize independently.
--
-- This migration preserves the 0029 atomic API and hash computation, but changes
-- write_audit_entry_atomic to take the existing legacy key ('dtm_audit_chain')
-- so it is mutually exclusive with write_audit_entry. It adds no triggers and
-- does not call application audit code, so it cannot recurse.

begin;

create or replace function public.write_audit_entry_atomic(
  p_actor_user_id uuid,
  p_actor_role    public.role_name,
  p_action        public.audit_action,
  p_entity_type   text,
  p_entity_id     text,
  p_patient_id    uuid,
  p_metadata_json jsonb,
  p_ip_address    inet,
  p_user_agent    text,
  p_created_at    timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tail_hash text;
  v_entry_hash text;
  v_new_id uuid;
  v_entity_uuid uuid;
  v_row_json jsonb;
begin
  -- Compatibility-critical: use the same key as legacy write_audit_entry so
  -- mixed old/new serverless instances cannot append against separate locks.
  if not pg_try_advisory_xact_lock(hashtext('dtm_audit_chain')) then
    raise exception 'audit chain lock busy' using errcode = '40001';
  end if;

  select entry_hash into v_tail_hash
    from public.audit_logs
    order by created_at desc, id desc
    limit 1;

  if p_entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_entity_uuid := p_entity_id::uuid;
  else
    v_entity_uuid := null;
  end if;

  v_row_json := jsonb_build_object(
    'actor_user_id', p_actor_user_id,
    'actor_role', p_actor_role,
    'action', p_action,
    'entity_type', p_entity_type,
    'entity_id', v_entity_uuid,
    'patient_id', p_patient_id,
    'metadata_json', coalesce(p_metadata_json, '{}'::jsonb),
    'ip_address', p_ip_address,
    'user_agent', p_user_agent,
    'created_at', public.audit_iso8601_utc(p_created_at),
    'prev_hash', v_tail_hash
  );

  v_entry_hash := encode(
    digest(coalesce(v_tail_hash, '') || '|' || public.audit_canonical_json(v_row_json), 'sha256'),
    'hex'
  );

  insert into public.audit_logs (
    actor_user_id, actor_role, action, entity_type, entity_id,
    patient_id, metadata_json, ip_address, user_agent,
    created_at, prev_hash, entry_hash
  ) values (
    p_actor_user_id, p_actor_role, p_action, p_entity_type, v_entity_uuid,
    p_patient_id, coalesce(p_metadata_json, '{}'::jsonb), p_ip_address, p_user_agent,
    p_created_at, v_tail_hash, v_entry_hash
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

alter function public.write_audit_entry_atomic(
  uuid, public.role_name, public.audit_action, text, text, uuid, jsonb, inet, text, timestamptz
) owner to audit_writer;

revoke all on function public.write_audit_entry_atomic(
  uuid, public.role_name, public.audit_action, text, text, uuid, jsonb, inet, text, timestamptz
) from public;

grant execute on function public.write_audit_entry_atomic(
  uuid, public.role_name, public.audit_action, text, text, uuid, jsonb, inet, text, timestamptz
) to service_role;

commit;
