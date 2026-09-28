-- Forward-only security baseline. No practice or patient data is reseeded.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;
revoke create on schema public from public, anon, authenticated, audit_writer;

create table private.practice_bootstrap (
  id boolean primary key default true check (id),
  configuration_hash text not null,
  applied_at timestamptz not null default now()
);
revoke all on private.practice_bootstrap from public, anon, authenticated, service_role;

-- Resolve roles from the verified user, never mutable user_metadata. AAL1 can
-- still read its own profile to enrol MFA, but has no application data role.
create or replace function public.current_app_role()
returns public.role_name
language sql stable security definer
set search_path = ''
as $function$
  select r.name
  from public.app_users u
  join public.roles r on r.id = u.role_id
  where u.id = auth.uid() and u.status = 'active'
    and (auth.jwt()->>'aal') = 'aal2';
$function$;

-- Privileged operator-only operations are outside the exposed API schema.
alter function public.create_app_secret(text, text, text) set schema private;
alter function public.update_app_secret(text, text, text) set schema private;
alter function public.hard_delete_patient_data(uuid) set schema private;
alter function public.read_app_secret(text) set schema private;
alter function public.try_acquire_maintenance_lock(text, integer) set schema private;
alter function public.release_maintenance_lock(text) set schema private;

-- Preserve the server RPC contract. These wrappers confer no extra privilege;
-- only service_role can invoke either the wrapper or its private implementation.
create or replace function public.read_app_secret(p_name text)
returns text language sql security invoker set search_path = '' as $$
  select private.read_app_secret(p_name);
$$;
create or replace function public.try_acquire_maintenance_lock(p_name text, p_ttl_seconds integer)
returns boolean language sql security invoker set search_path = '' as $$
  select private.try_acquire_maintenance_lock(p_name, p_ttl_seconds);
$$;
create or replace function public.release_maintenance_lock(p_name text)
returns void language sql security invoker set search_path = '' as $$
  select private.release_maintenance_lock(p_name);
$$;

create or replace function public.stage_billing_export_items(
  p_actor_user_id uuid,
  p_hospital      text,
  p_export_month  date,
  p_patient_ids   uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role  public.role_name;
  v_count integer;
begin
  if v_actor is null or p_actor_user_id is distinct from v_actor then
    raise exception 'Actor user mismatch' using errcode = '42501';
  end if;
  v_role := (select public.current_app_role());
  if v_role is null or v_role not in ('doctor', 'staff') then
    raise exception 'billing export staging is restricted to staff and doctor'
      using errcode = '42501';
  end if;

  if p_export_month is distinct from date_trunc('month', p_export_month)::date then
    raise exception 'export_month must be the first day of the month';
  end if;

  insert into public.billing_export_items as bei (
    patient_id, hospital, export_month, file_number, patient_name,
    id_number, id_type, medical_aid_number, payer_type, status,
    created_by, updated_by, created_at, updated_at
  )
  select
    p.id,
    p.hospital,
    p_export_month,
    p.file_number,
    btrim(regexp_replace(concat_ws(' ', p.first_names, p.surname), '\s+', ' ', 'g')),
    p.id_number,
    p.id_type,
    ma.membership_number,
    p.payer_type,
    'pending'::public.billing_export_status,
    v_actor,
    v_actor,
    now(),
    now()
  from public.patients p
  left join public.patient_medical_aid ma on ma.patient_id = p.id
  where p.id = any(p_patient_ids)
    and p.hospital = p_hospital
    and p.status = 'active'
  on conflict (patient_id, hospital, export_month) do update
    set file_number        = excluded.file_number,
        patient_name       = excluded.patient_name,
        id_number          = excluded.id_number,
        id_type            = excluded.id_type,
        medical_aid_number = excluded.medical_aid_number,
        payer_type         = excluded.payer_type,
        updated_by         = excluded.updated_by,
        updated_at         = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function allocate_file_number(p_year int default null, p_prefix text default null)
returns text language plpgsql security definer as $$
declare
  v_year   int;
  v_seq    bigint;
  v_prefix text;
  v_format text;
  v_result text;
begin
  v_year := coalesce(p_year, extract(year from (now() at time zone 'Africa/Johannesburg'))::int);

  -- Resolve prefix before sequence allocation so counters are prefix-specific.
  select coalesce(p_prefix, file_number_prefix), file_number_format
    into v_prefix, v_format
    from practice_settings where id = 1;

  -- Lock or insert this year's sequence row for this prefix.
  insert into file_number_sequences (year, prefix, next_value)
    values (v_year, v_prefix, 1)
    on conflict (year, prefix) do nothing;

  -- Lock the (year, prefix) row up front so the reservation consult and any counter
  -- increment serialize against concurrent onboards for the same (year, prefix).
  perform 1
    from file_number_sequences
    where year = v_year
      and prefix = v_prefix
    for update;

  loop
  -- Reservation consult: consume the lowest unconsumed reserved slot before the counter.
  -- Plain FOR UPDATE (no SKIP LOCKED): the sequence-row lock above already serializes
  -- same-(year, prefix) onboards, so this blocks on contention rather than skipping -- a
  -- skipped row would silently leave a reservation unconsumed and burn a counter value.
  select seq
    into v_seq
    from file_number_reservations
    where prefix = v_prefix
      and year = v_year
      and consumed_at is null
    order by seq
    limit 1
    for update;

  if found then
    -- Consume the reserved slot. Do NOT advance next_value on this path.
    update file_number_reservations
      set consumed_at = now()
      where prefix = v_prefix
        and year = v_year
        and seq = v_seq;
  else
    -- No reservation: existing counter-increment logic, unchanged.
    update file_number_sequences
      set next_value = next_value + 1
      where year = v_year
        and prefix = v_prefix
      returning next_value - 1 into v_seq;
  end if;

  v_result := replace(v_format, '{PREFIX}', v_prefix);
  v_result := replace(v_result, '{YYYY}', v_year::text);
  v_result := replace(v_result, '{SEQ:06}', lpad(v_seq::text, greatest(6, length(v_seq::text)), '0'));

  -- Retired numbers remain unavailable for every supported format, including
  -- formats which the legacy reassignment parser could not decompose.
  exit when not exists (select 1 from public.patients where file_number = v_result)
    and not exists (select 1 from public.patient_file_number_history
      where old_file_number = v_result or new_file_number = v_result);
  end loop;
  return v_result;
end $$;

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

  -- App-role guard (defence in depth alongside the API's requireRole): only
  -- doctor and staff may onboard. current_app_role() returns NULL for missing,
  -- deactivated, or role-less profiles, so all of those are refused here.
  v_actor_role := (select public.current_app_role());
  if v_actor_role is null or v_actor_role not in ('doctor', 'staff') then
    raise exception 'patient onboarding is restricted to staff and doctor'
      using errcode = '42501';
  end if;

  v_hospital := nullif(btrim(p_section_a->>'hospital'), '');
  v_is_minor := coalesce(nullif(p_section_a->>'is_minor', '')::boolean, false);
  v_patient_id_type := nullif(btrim(p_section_a->>'id_type'), '');

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

  -- Validate consent at the RPC boundary too. The API is not the only possible
  -- caller of an intentionally authenticated SECURITY DEFINER function.
  if not exists (
    select 1 from public.practice_settings s where s.id = 1
      and length(btrim(s.active_consent_body)) > 0
      and s.active_consent_version = p_consent->>'consent_text_version'
      and encode(extensions.digest(s.active_consent_version || '::' || s.active_consent_body, 'sha256'), 'hex') = p_consent->>'consent_text_hash'
  ) or coalesce(p_consent->>'patient_present_attestation', 'false') <> 'true'
    or coalesce(btrim(p_consent->>'signature_value'), '') = '' then
    raise exception 'Current consent and patient attestation required' using errcode = '22023';
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

-- Supabase default privileges can give explicit anon/authenticated grants even
-- after PUBLIC has been revoked. Start from a closed application function set.
-- Extension-owned functions are deliberately excluded.
do $acl$
declare f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prokind = 'f'
      and not exists (select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    -- pg_temp is explicitly LAST: unqualified relations cannot be shadowed by
    -- temporary objects. All preceding schemas have trusted owners only.
    execute format('alter function %s set search_path = pg_catalog, public, extensions, vault, pg_temp', f.signature);
  end loop;
end;
$acl$;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated;

grant execute on function public.current_app_role(), public.is_doctor(), public.is_staff(), public.is_admin(),
  public.get_my_app_profile(),
  public.onboard_patient(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb),
  public.reassign_patient_hospital(uuid,text,text),
  public.stage_billing_export_items(uuid,text,date,uuid[]),
  public.update_patient_bundle(uuid,jsonb,jsonb,jsonb,jsonb,jsonb),
  public.void_clinical_note(uuid,text)
to authenticated;

revoke all on function public.allocate_file_number(integer,text) from service_role;
-- Secret creation/rotation and destructive cleanup now require an operator
-- database connection. Service_role only retains KEK reads and maintenance.
revoke all on function private.create_app_secret(text,text,text),
  private.update_app_secret(text,text,text), private.hard_delete_patient_data(uuid)
from service_role;
grant execute on function private.read_app_secret(text),
  private.try_acquire_maintenance_lock(text,integer), private.release_maintenance_lock(text),
  public.read_app_secret(text), public.try_acquire_maintenance_lock(text,integer),
  public.release_maintenance_lock(text)
to service_role;

-- Restrictive policies cannot be bypassed by an additional permissive policy.
-- Self-profile and role-name reads stay available during MFA enrolment.
do $mfa$
declare t text;
begin
  foreach t in array array[
    'patients','patient_account_responsible','patient_medical_aid',
    'patient_emergency_contacts','patient_referrals','patient_dependants',
    'patient_documents','consent_records','clinical_notes','patient_encryption_keys',
    'audit_logs','break_glass_requests','billing_export_items','patient_file_number_history'
  ] loop
    execute format('create policy require_aal2 on public.%I as restrictive for all to authenticated using ((select auth.jwt()->>''aal'') = ''aal2'') with check ((select auth.jwt()->>''aal'') = ''aal2'')', t);
  end loop;
end;
$mfa$;

alter table public.roles enable row level security;
create policy roles_authenticated_read on public.roles for select to authenticated using (true);
revoke all on public.roles from anon;

-- Role changes and break-glass timing are controlled and audited by server
-- routes. Direct browser writes would bypass those checks, including cooldown.
revoke insert, update, delete on public.app_users, public.break_glass_requests
  from anon, authenticated;
drop policy if exists app_users_admin_write on public.app_users;
drop policy if exists break_glass_admin on public.break_glass_requests;
create policy break_glass_admin_read on public.break_glass_requests
  for select to authenticated using ((select public.current_app_role()) = 'admin'::public.role_name);

-- Replace the misleading permissive "deny" policy, which permitted writes to
-- every other bucket. Patient bytes remain accessible only via server URLs.
drop policy if exists "patient-documents deny all to authenticated" on storage.objects;
drop policy if exists "practice-brand read to authenticated" on storage.objects;
create policy private_practice_storage on storage.objects as restrictive
  for all to anon, authenticated
  using (bucket_id not in ('patient-documents', 'practice-brand'))
  with check (bucket_id not in ('patient-documents', 'practice-brand'));
update storage.buckets set public = false where id in ('patient-documents','practice-brand');

-- Advisor findings from a real fresh local rebuild.
alter table public.audit_log_outbox enable row level security;
revoke all on public.audit_log_outbox from public, anon, authenticated;
grant select, insert, update on public.audit_log_outbox to service_role;
alter extension pg_trgm set schema extensions;
-- jsonb conversion has stable dependencies; do not promise immutability to
-- the optimiser. The canonical bytes and audit-chain algorithm are unchanged.
alter function public.audit_canonical_json(jsonb) stable;

-- Remove defaults which could recreate another practice's identity. Existing
-- singleton rows and historical migration data are preserved until bootstrap.
alter table public.practice_settings
  alter column practice_name drop default,
  alter column practice_tagline drop default,
  alter column practice_number drop default,
  alter column doctor_name drop default,
  alter column doctor_qualifications drop default,
  alter column practice_address drop default,
  alter column practice_phone drop default,
  alter column information_officer_name drop default,
  alter column file_number_prefix drop default,
  alter column consent_cards set default '[]'::jsonb;

commit;
