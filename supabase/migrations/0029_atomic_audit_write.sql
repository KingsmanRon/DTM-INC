-- 0029_atomic_audit_write.sql
--
-- Drafted for review; do not apply automatically.
--
-- Removes the app-side "read latest audit_logs.entry_hash, then RPC insert"
-- pattern by moving tail lookup, next-hash computation, and insert into one
-- SECURITY DEFINER function. The transaction-scoped advisory lock serialises
-- hash-chain writers so two concurrent requests cannot append to the same tail.
--
-- This does not add triggers and does not call application audit code, so it
-- cannot recursively write audit rows.

begin;

create or replace function public.audit_canonical_json(p_value jsonb)
returns text
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $$
declare
  v_type text := jsonb_typeof(p_value);
  v_result text;
begin
  if v_type = 'null' then
    return 'null';
  elsif v_type in ('string', 'number', 'boolean') then
    return p_value::text;
  elsif v_type = 'array' then
    select '[' || coalesce(string_agg(public.audit_canonical_json(value), ',' order by ord), '') || ']'
      into v_result
      from jsonb_array_elements(p_value) with ordinality as a(value, ord);
    return v_result;
  elsif v_type = 'object' then
    select '{' || coalesce(string_agg(to_jsonb(key)::text || ':' || public.audit_canonical_json(value), ',' order by key), '') || '}'
      into v_result
      from jsonb_each(p_value) as e(key, value);
    return v_result;
  end if;

  raise exception 'unsupported jsonb type for audit canonicalisation: %', v_type;
end;
$$;

create or replace function public.audit_iso8601_utc(p_value timestamptz)
returns text
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select to_char(p_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

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
  -- Non-blocking transaction-scoped advisory lock. This preserves the safety of
  -- pg_advisory_xact_lock while keeping the 0024 incident fix: callers do not
  -- wait forever if a PostgREST session is stuck holding the chain lock.
  if not pg_try_advisory_xact_lock(hashtext('audit_logs_hash_chain')) then
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

revoke all on function public.audit_canonical_json(jsonb) from public;
revoke all on function public.audit_iso8601_utc(timestamptz) from public;
revoke all on function public.write_audit_entry_atomic(
  uuid, public.role_name, public.audit_action, text, text, uuid, jsonb, inet, text, timestamptz
) from public;

grant execute on function public.write_audit_entry_atomic(
  uuid, public.role_name, public.audit_action, text, text, uuid, jsonb, inet, text, timestamptz
) to service_role;

commit;
