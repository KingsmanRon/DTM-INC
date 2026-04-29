-- Slice 1: onboarding paper-form field alignment.
-- Safe additive migration only; no auth/RLS weakening.

-- 1) Expand enums for new UI options.
do $$ begin
  alter type id_type add value if not exists 'other';
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type marital_status add value if not exists 'partnered';
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type referrer_type add value if not exists 'hospital';
exception when duplicate_object then null;
end $$;

-- 2) Referral notes field.
alter table patient_referrals
  add column if not exists referral_notes text;

-- 3) Extend onboarding RPC to persist referral_notes.
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
    patient_id, referrer_type, referrer_name, referrer_phone, referral_notes, created_by, updated_by
  ) values (
    v_patient_id,
    (p_section_e->>'referrer_type')::referrer_type,
    nullif(p_section_e->>'referrer_name', ''),
    nullif(p_section_e->>'referrer_phone', ''),
    nullif(p_section_e->>'referral_notes', ''),
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
