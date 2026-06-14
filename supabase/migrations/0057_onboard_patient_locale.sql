-- 0057_onboard_patient_locale.sql — onboard_patient v4 (locale-aware).
--
-- Adds a US identity branch to the 0045 body; the SA path is byte-for-byte
-- unchanged. The locale is read from practice_settings.locale (0056) — a
-- trusted, server-side value — NOT from the payload, so an SA practice cannot
-- create an identity-less ('none') patient and a US practice cannot smuggle in
-- an unvalidated SA ID.
--
--   * locale 'za' (default): existing rules. Adults need SA ID/passport + a
--     number; minors may be none_minor or SA ID/passport. id_type 'none' is
--     rejected (it is not in either allow-list), exactly as before.
--   * locale 'us': no national ID. id_type MUST be 'none'; date_of_birth is the
--     required identity anchor; ssn_last4 optional (exactly 4 digits). For US
--     minors only the guardian NAME is required (US guardians carry no national
--     ID), unlike SA minors which still require a guardian id_number.
--
-- date_of_birth + ssn_last4 (0055) are now written on the patient row; both stay
-- NULL for SA. File numbering still uses the hospital prefix for both locales —
-- the US MRN rework is a separate, later slice.
--
-- Canonical: supabase/functions/onboard_patient.sql, regenerated from this file
-- by scripts/check-canonical-functions.mjs.

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
  v_actor_role public.role_name;
  v_patient_id_type text;
  v_locale text;
  v_dob_text text;
  v_dob date;
  v_ssn text;
begin
  -- Supabase Auth guard.
  v_actor_user_id := auth.uid();

  if v_actor_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_actor_user_id is distinct from v_actor_user_id then
    raise exception 'Actor user mismatch';
  end if;

  -- App-role guard (defence in depth alongside the API's requireRole): only
  -- doctor and staff may onboard.
  v_actor_role := (select public.current_app_role());
  if v_actor_role is null or v_actor_role not in ('doctor', 'staff') then
    raise exception 'patient onboarding is restricted to staff and doctor'
      using errcode = '42501';
  end if;

  -- Trusted locale (0056). Missing row/value → 'za' so SA stays the default.
  select coalesce(ps.locale, 'za') into v_locale
    from public.practice_settings ps
    where ps.id = 1;
  v_locale := coalesce(v_locale, 'za');

  v_hospital := nullif(btrim(p_section_a->>'hospital'), '');
  v_is_minor := coalesce(nullif(p_section_a->>'is_minor', '')::boolean, false);
  v_patient_id_type := nullif(btrim(p_section_a->>'id_type'), '');
  v_dob_text := nullif(btrim(p_section_a->>'date_of_birth'), '');
  v_ssn := nullif(btrim(p_section_a->>'ssn_last4'), '');

  -- Hospital -> prefix resolution from public.hospitals (0044). Hard-fail on
  -- unknown or inactive — there is deliberately no fallback prefix.
  select h.file_prefix into v_prefix
    from public.hospitals h
    where h.name = v_hospital
      and h.active;

  if v_hospital is null or v_prefix is null then
    raise exception 'Invalid or inactive hospital value: %', coalesce(v_hospital, 'null')
      using hint = 'Add or activate the hospital in public.hospitals before onboarding.';
  end if;

  if coalesce(btrim(p_section_a->>'first_names'), '') = ''
     or coalesce(btrim(p_section_a->>'surname'), '') = '' then
    raise exception 'Patient first names and surname are required';
  end if;

  if v_patient_id_type is null then
    raise exception 'Patient ID type is required';
  end if;

  if v_locale = 'us' then
    -- US identity: name + date_of_birth, no national ID.
    if v_patient_id_type <> 'none' then
      raise exception 'US patients use id type "none" (name + date of birth; no national ID)';
    end if;

    if v_dob_text is null then
      raise exception 'Patient date of birth is required';
    end if;
    if v_dob_text !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Date of birth must be in YYYY-MM-DD format';
    end if;
    v_dob := v_dob_text::date;  -- rejects impossible dates (e.g. 2021-02-30)

    if v_ssn is not null and v_ssn !~ '^\d{4}$' then
      raise exception 'SSN last 4 must be exactly 4 digits';
    end if;

    -- US minors: guardian NAME required (no national ID expected).
    if v_is_minor then
      if coalesce(btrim(p_section_b->>'first_names'), '') = ''
         or coalesce(btrim(p_section_b->>'surname'), '') = '' then
        raise exception 'Guardian/responsible-party name is required for minors';
      end if;
    end if;
  else
    -- SA (locale 'za') — unchanged from 0045.
    v_dob := null;  -- SA derives DOB from the SA ID; not stored on the patient row
    v_ssn := null;  -- SSN is a US-only field

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
    date_of_birth,
    ssn_last4,
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
    v_dob,
    v_ssn,
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

-- Execution stays locked to authenticated users (create or replace preserves
-- privileges; re-asserted here to match 0017/0045).
revoke all on function public.onboard_patient(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) from public;

grant execute on function public.onboard_patient(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb
) to authenticated;
