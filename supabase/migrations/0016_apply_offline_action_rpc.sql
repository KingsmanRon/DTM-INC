-- 0016_apply_offline_action_rpc.sql
-- Server-side offline action application with idempotency persistence.

create or replace function apply_offline_action(
  p_actor_user_id uuid,
  p_actor_role role_name,
  p_client_action_id text,
  p_action_type text,
  p_appointment_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing offline_sync_events%rowtype;
  v_result jsonb := '{}'::jsonb;
  v_target_table text := 'appointments';
  v_target_id uuid := p_appointment_id;
begin
  select *
    into v_existing
    from offline_sync_events
   where client_action_id = p_client_action_id
   limit 1;

  if found then
    return jsonb_build_object('status', 'synced', 'result', coalesce(v_existing.response_payload, '{}'::jsonb));
  end if;

  if p_action_type = 'appointment_create' then
    insert into appointments (
      patient_id, doctor_id, scheduled_at, reason, notes, status, created_by, updated_by
    ) values (
      (p_payload->>'patient_id')::uuid,
      (p_payload->>'doctor_id')::uuid,
      (p_payload->>'scheduled_at')::timestamptz,
      nullif(p_payload->>'reason', ''),
      nullif(p_payload->>'notes', ''),
      'scheduled',
      p_actor_user_id,
      p_actor_user_id
    )
    returning id into v_target_id;

    v_result := jsonb_build_object('appointment_id', v_target_id);
  elsif p_action_type = 'appointment_update' then
    update appointments
       set scheduled_at = coalesce((p_payload->>'scheduled_at')::timestamptz, scheduled_at),
           reason = coalesce(p_payload->>'reason', reason),
           notes = coalesce(p_payload->>'notes', notes),
           status = coalesce((p_payload->>'status')::appointment_status, status),
           updated_by = p_actor_user_id
     where id = p_appointment_id;

    v_result := jsonb_build_object('appointment_id', p_appointment_id);
  elsif p_action_type = 'appointment_check_in' then
    update appointments
       set status = 'arrived',
           checked_in_at = now(),
           updated_by = p_actor_user_id
     where id = p_appointment_id
     returning id, patient_id, doctor_id into v_target_id;

    v_result := jsonb_build_object('appointment_id', p_appointment_id);
  elsif p_action_type in ('queue_start', 'queue_complete') then
    update appointment_queue
       set status = case when p_action_type = 'queue_start' then 'in_room'::appointment_queue_status else 'completed'::appointment_queue_status end,
           in_room_at = case when p_action_type = 'queue_start' then now() else in_room_at end,
           completed_at = case when p_action_type = 'queue_complete' then now() else completed_at end,
           updated_by = p_actor_user_id
     where id = coalesce((p_payload->>'queue_id')::uuid, p_appointment_id);

    v_target_table := 'appointment_queue';
    v_target_id := coalesce((p_payload->>'queue_id')::uuid, p_appointment_id);
    v_result := jsonb_build_object('queue_id', v_target_id);
  else
    insert into offline_sync_events (
      client_action_id, actor_user_id, target_table, target_id, action_name, request_payload, status, error_message, processed_at, created_by, updated_by
    ) values (
      p_client_action_id, p_actor_user_id, 'unknown', p_appointment_id, p_action_type, p_payload, 'failed', 'unsupported_action_type', now(), p_actor_user_id, p_actor_user_id
    );
    return jsonb_build_object('status', 'conflict', 'conflict', jsonb_build_object('reason', 'unsupported_action_type'));
  end if;

  insert into offline_sync_events (
    client_action_id, actor_user_id, target_table, target_id, action_name, request_payload, response_payload, status, processed_at, created_by, updated_by
  ) values (
    p_client_action_id, p_actor_user_id, v_target_table, v_target_id, p_action_type, p_payload, v_result, 'processed', now(), p_actor_user_id, p_actor_user_id
  );

  return jsonb_build_object('status', 'synced', 'result', v_result);
end;
$$;

grant execute on function apply_offline_action(uuid, role_name, text, text, uuid, jsonb) to service_role;
