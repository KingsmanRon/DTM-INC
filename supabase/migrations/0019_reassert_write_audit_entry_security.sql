-- Reassert write_audit_entry() security invariants for environments where
-- the function or grants may have drifted after manual SQL changes.

begin;

-- Ensure the function is SECURITY DEFINER and keeps the expected body.
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
  perform pg_advisory_xact_lock(hashtext('dtm_audit_chain'));

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

-- Keep ownership/execute model explicit and idempotent.
alter function public.write_audit_entry(
  text, text, uuid, public.role_name, public.audit_action, text, uuid, uuid, jsonb, inet, text, timestamptz
) owner to audit_writer;

revoke all on function public.write_audit_entry(
  text, text, uuid, public.role_name, public.audit_action, text, uuid, uuid, jsonb, inet, text, timestamptz
) from public;
grant execute on function public.write_audit_entry(
  text, text, uuid, public.role_name, public.audit_action, text, uuid, uuid, jsonb, inet, text, timestamptz
) to service_role;

-- Keep direct table writes blocked from service_role.
revoke insert on table public.audit_logs from service_role;

commit;
