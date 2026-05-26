-- Add minor onboarding support safely.
-- Assumes Supabase/Postgres 12+.

-- 1) Add new enum value.
-- Important: later checks below compare id_type::text to avoid unsafe enum literal use
-- in the same pasted run.
alter type public.id_type add value if not exists 'none_minor';


-- 2) Add and backfill minor flag.
alter table public.patients
  add column if not exists is_minor boolean;

update public.patients
set is_minor = false
where is_minor is null;

alter table public.patients
  alter column is_minor set default false,
  alter column is_minor set not null;


-- 3) Allow id_number to be NULL.
-- Adults are still protected by the CHECK constraint below.
-- This is required so minors with id_type = none_minor can be created.
alter table public.patients
  alter column id_number drop not null;


-- 4) Replace identity/minor guardrail constraint.
alter table public.patients
  drop constraint if exists patients_identity_minor_guardrails;

alter table public.patients
  add constraint patients_identity_minor_guardrails
  check (
    (
      is_minor is false
      and id_type is not null
      and id_type::text in ('sa_id', 'passport')
      and coalesce(btrim(id_number), '') <> ''
      and (
        id_type::text <> 'passport'
        or coalesce(btrim(id_country), '') <> ''
      )
    )
    or
    (
      is_minor is true
      and id_type is not null
      and (
        id_type::text = 'none_minor'
        or (
          id_type::text in ('sa_id', 'passport')
          and coalesce(btrim(id_number), '') <> ''
          and (
            id_type::text <> 'passport'
            or coalesce(btrim(id_country), '') <> ''
          )
        )
      )
    )
  )
  not valid;

comment on constraint patients_identity_minor_guardrails on public.patients is
'Adults require SA ID or passport. Minors may use none_minor, or SA ID/passport if available. Uses text comparison so the new enum value can be added and the constraint created in one run.';


-- 5) Replace onboarding function.
create or replace function public.onboard_patient(
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
set search_path = public, auth, pg_temp
as $$
declare
  v_file_number text;
  v_patient_id uuid;
  v_dep jsonb;
  v_payer public.payer_type;
  v_hospital text;
  v_prefix text;
  v_is_minor boolean;
  v_actor_user_id uuid;
  v_patient_id_type text;

  -- Single source of truth for hospital -> file prefix allocation.
  v_hospital_prefix_map constant jsonb := '{
    "Nkanyezi Private Hospital": "NKA",
    "Fountain Private Hospital": "FOU",
    "Mediclinic Vereeniging Hospital": "MED",
    "Midvaal Private Hospital": "MID"
  }'::jsonb;
begin
  -- Supabase Auth guard.
  -- Prevents a caller from pretending another user created the patient.
  v_actor_user_id := auth.uid();

  if v_actor_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_actor_user_id is distinct from v_actor_user_id then
    raise exception 'Actor user mismatch';
  end if;

  v_hospital := nullif(btrim(p_section_a->>'hospital'), '');
  v_is_minor := coalesce(nullif(p_section_a->>'is_minor', '')::boolean, false);
  v_patient_id_type := nullif(btrim(p_section_a->>'id_type'), '');

  if v_hospital is null or not (v_hospital_prefix_map ? v_hospital) then
    raise exception 'Invalid hospital value: %', coalesce(v_hospital, 'null');
  end if;

  if coalesce(btrim(p_section_a->>'first_names'), '') = ''
     or coalesce(btrim(p_section_a->>'surname'), '') = '' then
    raise exception 'Patient first names and surname are required';
  end if;

  if v_patient_id_type is null then
    raise exception 'Patient ID type is required';
  end if;

  -- Adult identity rules.
  if not v_is_minor then
    if v_patient_id_type not in ('sa_id', 'passport') then
      raise exception 'Adults must use SA ID or passport';
    end if;

    if coalesce(btrim(p_section_a->>'id_number'), '') = '' then
      raise exception 'Adult patient ID/passport number is required';
    end if;

    if v_patient_id_type = 'passport'
       and coalesce(btrim(p_section_a->>'id_country'), '') = '' then
      raise exception 'Passport country is required for passport ID type';
    end if;
  end if;

  -- Minor identity rules.
  if v_is_minor then
    if v_patient_id_type not in ('none_minor', 'sa_id', 'passport') then
      raise exception 'Minor must use none_minor, SA ID, or passport';
    end if;

    if v_patient_id_type in ('sa_id', 'passport')
       and coalesce(btrim(p_section_a->>'id_number'), '') = '' then
      raise exception 'Minor ID/passport number is required when ID type is SA ID or passport';
    end if;

    if v_patient_id_type = 'passport'
       and coalesce(btrim(p_section_a->>'id_country'), '') = '' then
      raise exception 'Passport country is required for passport ID type';
    end if;

    if coalesce(btrim(p_section_b->>'first_names'), '') = ''
       or coalesce(btrim(p_section_b->>'surname'), '') = ''
       or coalesce(btrim(p_section_b->>'id_number'), '') = '' then
      raise exception 'Guardian/responsible-party identity details are required for minors';
    end if;
  end if;

  v_prefix := v_hospital_prefix_map ->> v_hospital;

  if v_prefix is null then
    raise exception 'No file number prefix configured for hospital: %', v_hospital
      using hint = 'Update v_hospital_prefix_map before onboarding this hospital.';
  end if;

  -- First argument is intentionally NULL for single-tenant mode.
  v_file_number := public.allocate_file_number(null, v_prefix);

  v_payer := case
    when coalesce(nullif(p_section_c->>'is_private_payer', '')::boolean, false)
      then 'private'::public.payer_type
    else 'medical_aid'::public.payer_type
  end;

  insert into public.patients (
    file_number,
    hospital,
    is_minor,
    title,
    first_names,
    surname,
    id_number,
    id_type,
    id_country,
    email,
    phone,
    address,
    payer_type,
    created_by,
    updated_by
  ) values (
    v_file_number,
    v_hospital,
    v_is_minor,
    nullif(p_section_a->>'title', '')::public.title_enum,
    p_section_a->>'first_names',
    p_section_a->>'surname',
    nullif(p_section_a->>'id_number', ''),
    v_patient_id_type::public.id_type,
    nullif(p_section_a->>'id_country', ''),
    nullif(p_section_a->>'email', ''),
    p_section_a->>'phone',
    p_section_a->>'address',
    v_payer,
    v_actor_user_id,
    v_actor_user_id
  )
  returning id into v_patient_id;

  insert into public.patient_account_responsible (
    patient_id,
    same_as_patient,
    title,
    first_names,
    surname,
    id_number,
    date_of_birth,
    marital_status,
    email,
    phone,
    home_address,
    spouse_partner_phone,
    spouse_partner_work_phone,
    employer_name,
    occupation,
    work_address,
    work_phone,
    created_by,
    updated_by
  ) values (
    v_patient_id,
    coalesce(nullif(p_section_b->>'same_as_patient', '')::boolean, false),
    nullif(p_section_b->>'title', '')::public.title_enum,
    p_section_b->>'first_names',
    p_section_b->>'surname',
    p_section_b->>'id_number',
    nullif(p_section_b->>'date_of_birth', '')::date,
    nullif(p_section_b->>'marital_status', '')::public.marital_status,
    nullif(p_section_b->>'email', ''),
    p_section_b->>'phone',
    p_section_b->>'home_address',
    nullif(p_section_b->>'spouse_partner_phone', ''),
    nullif(p_section_b->>'spouse_partner_work_phone', ''),
    nullif(p_section_b->>'employer_name', ''),
    nullif(p_section_b->>'occupation', ''),
    nullif(p_section_b->>'work_address', ''),
    nullif(p_section_b->>'work_phone', ''),
    v_actor_user_id,
    v_actor_user_id
  );

  insert into public.patient_medical_aid (
    patient_id,
    same_as_responsible,
    main_member_name,
    medical_aid_name,
    membership_number,
    plan,
    other_plan_detail,
    created_by,
    updated_by
  ) values (
    v_patient_id,
    coalesce(nullif(p_section_c->>'same_as_responsible', '')::boolean, true),
    nullif(p_section_c->>'main_member_name', ''),
    nullif(p_section_c->>'medical_aid_name', ''),
    nullif(p_section_c->>'membership_number', ''),
    nullif(p_section_c->>'plan', ''),
    nullif(p_section_c->>'other_plan_detail', ''),
    v_actor_user_id,
    v_actor_user_id
  );

  insert into public.patient_emergency_contacts (
    patient_id,
    name,
    relationship,
    address,
    email,
    phone,
    created_by,
    updated_by
  ) values (
    v_patient_id,
    p_section_d->>'name',
    p_section_d->>'relationship',
    nullif(p_section_d->>'address', ''),
    nullif(p_section_d->>'email', ''),
    p_section_d->>'phone',
    v_actor_user_id,
    v_actor_user_id
  );

  insert into public.patient_referrals (
    patient_id,
    referrer_type,
    referrer_name,
    referrer_phone,
    referral_notes,
    created_by,
    updated_by
  ) values (
    v_patient_id,
    nullif(p_section_e->>'referrer_type', '')::public.referrer_type,
    nullif(p_section_e->>'referrer_name', ''),
    nullif(p_section_e->>'referrer_phone', ''),
    nullif(p_section_e->>'referral_notes', ''),
    v_actor_user_id,
    v_actor_user_id
  );

  if p_dependants is not null then
    if jsonb_typeof(p_dependants) <> 'array' then
      raise exception 'Dependants must be a JSON array';
    end if;

    for v_dep in select * from jsonb_array_elements(p_dependants)
    loop
      insert into public.patient_dependants (
        patient_id,
        name,
        sex,
        date_of_birth,
        dependant_code,
        allergies,
        created_by,
        updated_by
      ) values (
        v_patient_id,
        v_dep->>'name',
        nullif(v_dep->>'sex', '')::public.sex_enum,
        nullif(v_dep->>'date_of_birth', '')::date,
        v_dep->>'dependant_code',
        nullif(v_dep->>'allergies', ''),
        v_actor_user_id,
        v_actor_user_id
      );
    end loop;
  end if;

  insert into public.consent_records (
    patient_id,
    consent_text_version,
    consent_text_hash,
    consent_summary_version,
    accepted_by_user_id,
    signature_type,
    signature_value,
    patient_present_attestation
  ) values (
    v_patient_id,
    p_consent->>'consent_text_version',
    p_consent->>'consent_text_hash',
    nullif(p_consent->>'consent_summary_version', ''),
    v_actor_user_id,
    nullif(p_consent->>'signature_type', '')::public.signature_type,
    p_consent->>'signature_value',
    coalesce(nullif(p_consent->>'patient_present_attestation', '')::boolean, false)
  );

  patient_id := v_patient_id;
  file_number := v_file_number;
  return next;
end;
$$;


-- 6) Lock function execution to authenticated users.
revoke all on function public.onboard_patient(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) from public;

grant execute on function public.onboard_patient(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) to authenticated;
