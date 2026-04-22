-- 0006_hardening.sql — post-review hardening.
--
-- Bundles four changes that share infrastructure (SECURITY DEFINER RPCs +
-- privilege tightening):
--
--   • H2 / M1: onboard_patient(...) wraps all 7 onboarding inserts in one
--     transaction and guarantees partial-failure rollback.
--   • H3 / M1: write_audit_entry(...) runs under audit_writer, serialises
--     writes via advisory lock, and verifies prev_hash against the current
--     tail so two concurrent writers cannot fork the chain.
--   • M5:      doctor may SELECT audit_logs rows tagged with break-glass
--     actions even when actor_user_id != auth.uid() (they are the *subject*,
--     not the actor).
--
-- Idempotent: every DDL uses IF NOT EXISTS or CREATE OR REPLACE.

set statement_timeout = 0;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. write_audit_entry — serialised, tail-verified audit insert.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The Node layer still computes entry_hash (canonical JSON there matches the
-- verifier exactly). This function's job is to guarantee that:
--
--   (a) no two writers can observe the same tail prev_hash (advisory lock +
--       re-check against the current tail), and
--   (b) the caller's expected prev_hash matches what the DB currently holds.
--
-- On mismatch we raise SQLSTATE 40001 (serialization_failure). The Node
-- writeAudit wrapper retries on that code up to N times.

create or replace function write_audit_entry(
  p_expected_prev_hash text,
  p_entry_hash         text,
  p_actor_user_id      uuid,
  p_actor_role         role_name,
  p_action             audit_action,
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
  -- Serialise all audit writers cluster-wide on a well-known key.
  perform pg_advisory_xact_lock(hashtext('dtm_audit_chain'));

  select entry_hash into v_tail_hash
    from audit_logs
    order by created_at desc, id desc
    limit 1;

  -- Treat SQL NULL and empty string as equivalent for "no prev" so the JS
  -- caller can send either without forking the chain.
  if coalesce(v_tail_hash, '') is distinct from coalesce(p_expected_prev_hash, '') then
    raise exception 'audit chain tail moved: expected=%, actual=%',
      coalesce(p_expected_prev_hash, '<null>'),
      coalesce(v_tail_hash, '<null>')
      using errcode = '40001';
  end if;

  insert into audit_logs (
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

-- audit_writer owns the function so service_role does not need INSERT on the
-- table directly. The function is SECURITY DEFINER so it runs with the owner's
-- privileges regardless of which role calls it.
alter function write_audit_entry(text, text, uuid, role_name, audit_action, text, uuid, uuid, jsonb, inet, text, timestamptz) owner to audit_writer;

revoke all on function write_audit_entry(text, text, uuid, role_name, audit_action, text, uuid, uuid, jsonb, inet, text, timestamptz) from public;
grant execute on function write_audit_entry(text, text, uuid, role_name, audit_action, text, uuid, uuid, jsonb, inet, text, timestamptz) to service_role;

-- Now that every legitimate audit insert goes through the function, revoke
-- direct INSERT from service_role so a stolen service-role key cannot append
-- arbitrary rows. (0002 already revoked update/delete/truncate.)
revoke insert on audit_logs from service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. onboard_patient — transactional onboarding insert.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Replaces the 7 sequential admin inserts in POST /api/v1/patients. A single
-- call keeps the fan-out in one transaction: if a sub-resource insert fails,
-- the patient row is rolled back with it.
--
-- Input is one jsonb per section so the signature stays stable as the zod
-- schemas evolve. Structure is validated in Node via zod before the call, so
-- this function only defensively unpacks and relies on FK + NOT NULL.
--
-- allocate_file_number is invoked inline; the caller no longer does that.

create or replace function onboard_patient(
  p_actor_user_id uuid,
  p_section_a     jsonb,
  p_section_b     jsonb,
  p_section_c     jsonb,
  p_section_d     jsonb,
  p_section_e     jsonb,
  p_dependants    jsonb,
  p_consent       jsonb
)
returns table(patient_id uuid, file_number text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_file_number text;
  v_patient_id  uuid;
  v_dep         jsonb;
  v_payer       payer_type;
begin
  v_file_number := allocate_file_number(null, null);

  v_payer := case
    when coalesce((p_section_c->>'is_private_payer')::boolean, false) then 'private'::payer_type
    else 'medical_aid'::payer_type
  end;

  insert into patients (
    file_number, title, first_names, surname, id_number, id_type, id_country,
    email, phone, address, payer_type, created_by, updated_by
  ) values (
    v_file_number,
    (p_section_a->>'title')::title_enum,
    p_section_a->>'first_names',
    p_section_a->>'surname',
    p_section_a->>'id_number',
    (p_section_a->>'id_type')::id_type,
    nullif(p_section_a->>'id_country', ''),
    nullif(p_section_a->>'email', ''),
    p_section_a->>'phone',
    p_section_a->>'address',
    v_payer,
    p_actor_user_id,
    p_actor_user_id
  )
  returning id into v_patient_id;

  insert into patient_account_responsible (
    patient_id, same_as_patient, title, first_names, surname, id_number,
    date_of_birth, marital_status, email, phone, home_address,
    spouse_partner_phone, spouse_partner_work_phone,
    employer_name, occupation, work_address, work_phone,
    created_by, updated_by
  ) values (
    v_patient_id,
    coalesce((p_section_b->>'same_as_patient')::boolean, false),
    (p_section_b->>'title')::title_enum,
    p_section_b->>'first_names',
    p_section_b->>'surname',
    p_section_b->>'id_number',
    (p_section_b->>'date_of_birth')::date,
    (p_section_b->>'marital_status')::marital_status,
    nullif(p_section_b->>'email', ''),
    p_section_b->>'phone',
    p_section_b->>'home_address',
    nullif(p_section_b->>'spouse_partner_phone', ''),
    nullif(p_section_b->>'spouse_partner_work_phone', ''),
    nullif(p_section_b->>'employer_name', ''),
    nullif(p_section_b->>'occupation', ''),
    nullif(p_section_b->>'work_address', ''),
    nullif(p_section_b->>'work_phone', ''),
    p_actor_user_id,
    p_actor_user_id
  );

  insert into patient_medical_aid (
    patient_id, same_as_responsible, main_member_name, medical_aid_name,
    membership_number, plan, other_plan_detail, created_by, updated_by
  ) values (
    v_patient_id,
    coalesce((p_section_c->>'same_as_responsible')::boolean, true),
    nullif(p_section_c->>'main_member_name', ''),
    nullif(p_section_c->>'medical_aid_name', ''),
    nullif(p_section_c->>'membership_number', ''),
    nullif(p_section_c->>'plan', ''),
    nullif(p_section_c->>'other_plan_detail', ''),
    p_actor_user_id,
    p_actor_user_id
  );

  insert into patient_emergency_contacts (
    patient_id, name, relationship, address, email, phone, created_by, updated_by
  ) values (
    v_patient_id,
    p_section_d->>'name',
    p_section_d->>'relationship',
    nullif(p_section_d->>'address', ''),
    nullif(p_section_d->>'email', ''),
    p_section_d->>'phone',
    p_actor_user_id,
    p_actor_user_id
  );

  insert into patient_referrals (
    patient_id, referrer_type, referrer_name, referrer_phone, created_by, updated_by
  ) values (
    v_patient_id,
    (p_section_e->>'referrer_type')::referrer_type,
    nullif(p_section_e->>'referrer_name', ''),
    nullif(p_section_e->>'referrer_phone', ''),
    p_actor_user_id,
    p_actor_user_id
  );

  if p_dependants is not null and jsonb_typeof(p_dependants) = 'array' then
    for v_dep in select * from jsonb_array_elements(p_dependants)
    loop
      insert into patient_dependants (
        patient_id, name, sex, date_of_birth, dependant_code, allergies,
        created_by, updated_by
      ) values (
        v_patient_id,
        v_dep->>'name',
        (v_dep->>'sex')::sex_enum,
        (v_dep->>'date_of_birth')::date,
        v_dep->>'dependant_code',
        nullif(v_dep->>'allergies', ''),
        p_actor_user_id,
        p_actor_user_id
      );
    end loop;
  end if;

  insert into consent_records (
    patient_id, consent_text_version, consent_text_hash, accepted_by_user_id,
    signature_type, signature_value, patient_present_attestation
  ) values (
    v_patient_id,
    p_consent->>'consent_text_version',
    p_consent->>'consent_text_hash',
    p_actor_user_id,
    (p_consent->>'signature_type')::signature_type,
    p_consent->>'signature_value',
    coalesce((p_consent->>'patient_present_attestation')::boolean, false)
  );

  patient_id := v_patient_id;
  file_number := v_file_number;
  return next;
end;
$$;

revoke all on function onboard_patient(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function onboard_patient(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. M5 — doctor visibility of break-glass audit rows.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- audit_logs_doctor_own lets the doctor see rows where they were the actor.
-- But break-glass events are recorded with the admin as actor; the doctor is
-- the *subject* of the access. Without this policy, the doctor has no RLS
-- path to see that their records were opened under break-glass.

drop policy if exists audit_logs_doctor_break_glass on audit_logs;
create policy audit_logs_doctor_break_glass on audit_logs
  for select to authenticated
  using (
    is_doctor()
    and action in ('break_glass_request', 'break_glass_access')
  );
