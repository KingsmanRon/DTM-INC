-- 0032_reassert_atomic_audit_execute.sql
--
-- Fix: POST /rest/v1/rpc/write_audit_entry_atomic returns 403 from server-side
-- (Node) traffic, which makes every audit write fall back to audit_log_outbox
-- (the nearby 201 inserts). A 403 from PostgREST on an RPC is SQLSTATE 42501
-- (insufficient_privilege). For this function there are exactly two ways to hit
-- it, and both are addressed here with the narrowest possible change:
--
--   (a) The caller lacks EXECUTE on the function. The ONLY caller is the
--       service-role client (src/lib/audit/log.ts -> getSupabaseAdmin() ->
--       admin.rpc("write_audit_entry_atomic", ...)). PostgREST runs that under
--       the `service_role` Postgres role. anon/authenticated never call it.
--       => grant EXECUTE to service_role only; keep it revoked from
--          public/anon/authenticated.
--
--   (b) The SECURITY DEFINER owner (audit_writer) cannot write the chain, so the
--       INSERT inside the function trips RLS ("new row violates row-level
--       security policy", also 42501 -> 403). => confirm audit_writer keeps its
--       INSERT/SELECT table grants and RLS policies on audit_logs.
--
-- 0029/0030 introduced this function but were flagged "do not apply
-- automatically" and 0019 documents that grants drift after manual SQL edits.
-- This migration is idempotent and SAFE TO APPLY: it re-asserts the canonical
-- definition (legacy 'dtm_audit_chain' advisory key, identical to 0030), the
-- ownership, the EXECUTE grant, and the owner's write privileges. It does NOT
-- loosen RLS and grants no broad table permissions to anon/authenticated.

begin;

-- Canonicalisation helpers the atomic writer depends on (idempotent).
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

-- Canonical atomic writer. Body is identical to 0030 (legacy advisory-lock key
-- so it stays mutually exclusive with write_audit_entry during rolling deploys).
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

-- SECURITY DEFINER owner: audit_writer (so the chain insert runs as the
-- append-only role, not the broad service_role).
alter function public.write_audit_entry_atomic(
  uuid, public.role_name, public.audit_action, text, text, uuid, jsonb, inet, text, timestamptz
) owner to audit_writer;

-- (a) EXECUTE: service_role only. Explicitly keep it away from public and the
-- app roles so a leaked anon/authenticated token cannot append audit rows.
revoke all on function public.write_audit_entry_atomic(
  uuid, public.role_name, public.audit_action, text, text, uuid, jsonb, inet, text, timestamptz
) from public;
revoke execute on function public.write_audit_entry_atomic(
  uuid, public.role_name, public.audit_action, text, text, uuid, jsonb, inet, text, timestamptz
) from anon, authenticated;
grant execute on function public.write_audit_entry_atomic(
  uuid, public.role_name, public.audit_action, text, text, uuid, jsonb, inet, text, timestamptz
) to service_role;

revoke all on function public.audit_canonical_json(jsonb) from public;
revoke all on function public.audit_iso8601_utc(timestamptz) from public;

-- (b) Confirm the SECURITY DEFINER owner can write the hash chain. These already
-- exist (0002/0009/0018/0026) but are restated idempotently in case they drifted
-- — audit_writer is nologin/noinherit and only reachable through this function,
-- so this exposes nothing new and grants nothing to app roles.
grant select, insert on table public.audit_logs to audit_writer;

drop policy if exists audit_logs_writer_insert on public.audit_logs;
create policy audit_logs_writer_insert on public.audit_logs
  for insert to audit_writer
  with check (true);

drop policy if exists audit_logs_writer_select on public.audit_logs;
create policy audit_logs_writer_select on public.audit_logs
  for select to audit_writer
  using (true);

commit;
