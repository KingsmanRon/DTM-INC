-- Additive operations. Deploy the matching application before applying the
-- separate grant-revocation migration. See docs/internal/protected-record-rollout.md.
begin;

-- Persist mutation events in the EXISTING durable outbox in the same transaction
-- as the mutation. The normal bounded cron drains these into the hash chain.
-- This helper is not an authenticated-client audit-forgery endpoint.
create or replace function public.enqueue_record_mutation_audit(
  p_actor uuid, p_role public.role_name, p_action public.audit_action,
  p_entity_type text, p_entity_id uuid, p_patient_id uuid, p_metadata jsonb,
  p_ip_address inet default null, p_user_agent text default null
) returns void language sql security invoker set search_path = '' as $$
  insert into public.audit_log_outbox(payload_json, reason)
  values (jsonb_build_object(
    'actorUserId', p_actor, 'actorRole', p_role, 'action', p_action,
    'entityType', p_entity_type, 'entityId', p_entity_id, 'patientId', p_patient_id,
    'metadata', coalesce(p_metadata, '{}'::jsonb), 'ipAddress', p_ip_address,
    'userAgent', p_user_agent, 'occurredAt', clock_timestamp()
  ), 'transactional_record_mutation');
$$;
revoke all on function public.enqueue_record_mutation_audit(uuid, public.role_name, public.audit_action, text, uuid, uuid, jsonb, inet, text) from public, anon, authenticated;
grant execute on function public.enqueue_record_mutation_audit(uuid, public.role_name, public.audit_action, text, uuid, uuid, jsonb, inet, text) to service_role;

create table public.document_upload_intents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  actor_user_id uuid not null references public.app_users(id) on delete restrict,
  storage_key text not null unique,
  original_filename text not null check (length(original_filename) between 1 and 300),
  category public.doc_category not null,
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/heic','image/webp')),
  declared_size bigint not null check (declared_size between 1 and 10485760),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 hours'),
  document_id uuid unique references public.patient_documents(id) on delete restrict,
  check (storage_key like patient_id::text || '/%')
);
alter table public.document_upload_intents enable row level security;
revoke all on public.document_upload_intents from public, anon, authenticated;
grant select, insert, update on public.document_upload_intents to service_role;

-- Service-only: caller identity is derived by requireRole, and file properties
-- are measured by the server. Never grant authenticated EXECUTE on this RPC.
create or replace function public.finalize_document_upload(
  p_intent_id uuid, p_actor_user_id uuid, p_patient_id uuid,
  p_file_size bigint, p_sha256 text, p_mime text,
  p_ip_address inet default null, p_user_agent text default null
) returns setof public.patient_documents
language plpgsql security invoker set search_path = '' as $$
declare
  v_intent public.document_upload_intents%rowtype;
  v_document public.patient_documents%rowtype;
  v_role public.role_name;
begin
  select r.name into v_role from public.app_users u join public.roles r on r.id=u.role_id
   where u.id=p_actor_user_id and u.status='active';
  if v_role is null or v_role not in ('doctor','staff') then
    raise exception 'not authorised' using errcode='42501';
  end if;
  select * into v_intent from public.document_upload_intents
   where id=p_intent_id and actor_user_id=p_actor_user_id and patient_id=p_patient_id for update;
  if not found then raise exception 'upload intent not found' using errcode='PT404'; end if;
  if v_intent.document_id is not null then
    select * into v_document from public.patient_documents
     where id=v_intent.document_id and patient_id=p_patient_id and archived_at is null;
    if not found then raise exception 'upload already finalised' using errcode='PT409'; end if;
    return next v_document;
    return;
  end if;
  if v_intent.expires_at <= clock_timestamp() then
    raise exception 'upload intent expired' using errcode='PT410';
  end if;
  if p_file_size is distinct from v_intent.declared_size or
     p_mime is distinct from v_intent.mime_type or
     p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid upload attestation' using errcode='22023';
  end if;
  -- Covers both current references and originals retained by compression.
  if exists (select 1 from public.patient_documents where storage_key=v_intent.storage_key or original_storage_key=v_intent.storage_key) then
    raise exception 'object already registered' using errcode='PT409';
  end if;
  insert into public.patient_documents(patient_id, category, storage_key, original_filename, mime_type, file_size, sha256_hash, uploaded_by)
  values (p_patient_id, v_intent.category, v_intent.storage_key, v_intent.original_filename, p_mime, p_file_size, p_sha256, p_actor_user_id)
  returning * into v_document;
  update public.document_upload_intents set document_id=v_document.id where id=p_intent_id;
  perform public.enqueue_record_mutation_audit(p_actor_user_id,v_role,'document_upload','patient_documents',v_document.id,p_patient_id,
    jsonb_build_object('category',v_intent.category,'sha256',p_sha256,'size',p_file_size,'mime',p_mime,'storage_key',v_intent.storage_key),p_ip_address,p_user_agent);
  return next v_document;
end;
$$;
revoke all on function public.finalize_document_upload(uuid,uuid,uuid,bigint,text,text,inet,text) from public,anon,authenticated;
grant execute on function public.finalize_document_upload(uuid,uuid,uuid,bigint,text,text,inet,text) to service_role;

-- Archive permission is independent of demographics visibility. The server
-- authenticates doctor/admin (including MFA); the DB rechecks the active role.
create or replace function public.set_patient_archive_state(
  p_patient_id uuid, p_archived boolean, p_actor_user_id uuid,
  p_ip_address inet default null, p_user_agent text default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_role public.role_name; v_patient public.patients%rowtype;
begin
  select r.name into v_role from public.app_users u join public.roles r on r.id=u.role_id
   where u.id=p_actor_user_id and u.status='active';
  if v_role is null or v_role not in ('doctor','admin') then
    raise exception 'not authorised' using errcode='42501';
  end if;
  if p_archived is null then raise exception 'archive state required' using errcode='22023'; end if;
  select * into v_patient from public.patients where id=p_patient_id for update;
  if not found then raise exception 'patient not found' using errcode='PT404'; end if;
  if (v_patient.status='archived')=p_archived then
    raise exception 'patient already in requested state' using errcode='PT409';
  end if;
  update public.patients set
    status=case when p_archived then 'archived'::public.patient_status else 'active'::public.patient_status end,
    archived_at=case when p_archived then now() else null end,
    archived_by=case when p_archived then p_actor_user_id else null end,
    updated_by=p_actor_user_id where id=p_patient_id;
  perform public.enqueue_record_mutation_audit(p_actor_user_id,v_role,
    case when p_archived then 'patient_archive'::public.audit_action else 'patient_unarchive'::public.audit_action end,
    'patient',p_patient_id,p_patient_id,'{}'::jsonb,p_ip_address,p_user_agent);
  return p_patient_id;
end;
$$;
revoke all on function public.set_patient_archive_state(uuid,boolean,uuid,inet,text) from public,anon,authenticated;
grant execute on function public.set_patient_archive_state(uuid,boolean,uuid,inet,text) to service_role;

-- Service-only narrow document operation: no storage/hash/attribution fields
-- are accepted. Existing server-side filename validation remains authoritative.
create or replace function public.mutate_patient_document(
  p_patient_id uuid, p_document_id uuid, p_actor_user_id uuid, p_operation text,
  p_filename text default null, p_expected_filename text default null,
  p_reason text default null, p_ip_address inet default null, p_user_agent text default null
) returns setof public.patient_documents
language plpgsql security invoker set search_path = '' as $$
declare v_role public.role_name; v_doc public.patient_documents%rowtype; v_metadata jsonb; v_action public.audit_action;
begin
  select r.name into v_role from public.app_users u join public.roles r on r.id=u.role_id
   where u.id=p_actor_user_id and u.status='active';
  if v_role is null or v_role not in ('doctor','staff') then raise exception 'not authorised' using errcode='42501'; end if;
  select * into v_doc from public.patient_documents where id=p_document_id and patient_id=p_patient_id for update;
  if not found then raise exception 'document not found' using errcode='PT404'; end if;
  if v_doc.archived_at is not null then raise exception 'document archived' using errcode='PT409'; end if;
  if p_operation='rename' then
    if p_filename is null or length(btrim(p_filename)) not between 1 and 300 then
      raise exception 'invalid filename' using errcode='22023';
    end if;
    if p_expected_filename is distinct from v_doc.original_filename then
      raise exception 'document changed; refresh and retry' using errcode='PT409';
    end if;
    if p_filename=v_doc.original_filename then return next v_doc; return; end if;
    v_metadata:=jsonb_build_object('from',v_doc.original_filename,'to',p_filename);
    v_action:='document_rename';
    update public.patient_documents set original_filename=p_filename where id=p_document_id returning * into v_doc;
  elsif p_operation='archive' then
    v_metadata:=jsonb_build_object('filename',v_doc.original_filename,'category',v_doc.category);
    if p_reason is not null then v_metadata:=v_metadata || jsonb_build_object('reason',left(p_reason,500)); end if;
    v_action:='document_archive';
    update public.patient_documents set archived_at=now(),archived_by=p_actor_user_id where id=p_document_id returning * into v_doc;
  else
    raise exception 'invalid document operation' using errcode='22023';
  end if;
  perform public.enqueue_record_mutation_audit(p_actor_user_id,v_role,v_action,'patient_documents',p_document_id,p_patient_id,v_metadata,p_ip_address,p_user_agent);
  return next v_doc;
end;
$$;
revoke all on function public.mutate_patient_document(uuid,uuid,uuid,text,text,text,text,inet,text) from public,anon,authenticated;
grant execute on function public.mutate_patient_document(uuid,uuid,uuid,text,text,text,text,inet,text) to service_role;

-- Replace the old signature; defaults retain compatibility with six-argument callers.
drop function public.update_patient_bundle(uuid,jsonb,jsonb,jsonb,jsonb,jsonb);
create or replace function public.update_patient_bundle(
  p_patient_id  uuid,
  p_patient     jsonb default null,
  p_responsible jsonb default null,
  p_medical_aid jsonb default null,
  p_contact     jsonb default null,
  p_referral    jsonb default null,
  p_ip_address  inet default null,
  p_user_agent  text default null
)
returns setof public.patients
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_patient public.patients%rowtype;
  v_contact_id uuid;
  v_contact_count int;
  v_rows int;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_patient_id is null then
    raise exception 'patient_id is required' using errcode = '22023';
  end if;

  -- Direct table writes are revoked. This narrow definer operation therefore
  -- explicitly preserves the old RLS visibility boundary and PT404 semantics.
  if (select public.current_app_role()) is null or
     (select public.current_app_role()) not in ('doctor','staff') then
    raise exception 'patient not found' using errcode = 'PT404';
  end if;
  if coalesce(p_patient, '{}'::jsonb) ?| array['status','archived_at','archived_by','file_number','created_by','updated_by','id'] then
    raise exception 'protected patient fields require a dedicated operation' using errcode = '22023';
  end if;
  -- Lock the patient for the entire bundle update.
  select * into v_patient
    from public.patients
    where id = p_patient_id
    for update;
  if not found then
    raise exception 'patient not found' using errcode = 'PT404';
  end if;

  if p_patient is not null then
    if p_patient ? 'hospital'
       and nullif(btrim(p_patient->>'hospital'), '') is distinct from v_patient.hospital then
      raise exception 'hospital cannot be changed via demographics update'
        using errcode = 'PT409',
              hint = 'Hospital is fixed at onboarding; moving a patient is a deliberate operator action.';
    end if;

    update public.patients set
      title       = coalesce(nullif(p_patient->>'title', '')::public.title_enum, title),
      first_names = coalesce(nullif(btrim(p_patient->>'first_names'), ''), first_names),
      surname     = coalesce(nullif(btrim(p_patient->>'surname'), ''), surname),
      -- email is clearable: an explicit "email": null (or "") empties it.
      email       = case when p_patient ? 'email' then nullif(btrim(coalesce(p_patient->>'email', '')), '') else email end,
      phone       = coalesce(nullif(btrim(p_patient->>'phone'), ''), phone),
      address     = coalesce(nullif(btrim(p_patient->>'address'), ''), address),
      payer_type  = coalesce(nullif(p_patient->>'payer_type', '')::public.payer_type, payer_type),
      updated_by  = v_actor
    where id = p_patient_id;
  end if;

  if p_responsible is not null then
    update public.patient_account_responsible set
      first_names   = coalesce(nullif(btrim(p_responsible->>'first_names'), ''), first_names),
      surname       = coalesce(nullif(btrim(p_responsible->>'surname'), ''), surname),
      phone         = coalesce(nullif(btrim(p_responsible->>'phone'), ''), phone),
      employer_name = case when p_responsible ? 'employer_name' then nullif(btrim(coalesce(p_responsible->>'employer_name', '')), '') else employer_name end,
      occupation    = case when p_responsible ? 'occupation' then nullif(btrim(coalesce(p_responsible->>'occupation', '')), '') else occupation end,
      updated_by    = v_actor
    where patient_id = p_patient_id;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'no account-responsible record for this patient' using errcode = 'PT404';
    end if;
  end if;

  if p_medical_aid is not null then
    update public.patient_medical_aid set
      main_member_name  = case when p_medical_aid ? 'main_member_name' then nullif(btrim(coalesce(p_medical_aid->>'main_member_name', '')), '') else main_member_name end,
      medical_aid_name  = case when p_medical_aid ? 'medical_aid_name' then nullif(btrim(coalesce(p_medical_aid->>'medical_aid_name', '')), '') else medical_aid_name end,
      membership_number = case when p_medical_aid ? 'membership_number' then nullif(btrim(coalesce(p_medical_aid->>'membership_number', '')), '') else membership_number end,
      plan              = case when p_medical_aid ? 'plan' then nullif(btrim(coalesce(p_medical_aid->>'plan', '')), '') else plan end,
      updated_by        = v_actor
    where patient_id = p_patient_id;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'no medical-aid record for this patient' using errcode = 'PT404';
    end if;
  end if;

  if p_contact is not null then
    v_contact_id := nullif(p_contact->>'id', '')::uuid;
    if v_contact_id is null then
      select count(*) into v_contact_count
        from public.patient_emergency_contacts
        where patient_id = p_patient_id;
      if v_contact_count > 1 then
        raise exception 'contact id is required when the patient has multiple emergency contacts'
          using errcode = '22023';
      end if;
    end if;

    update public.patient_emergency_contacts set
      name         = coalesce(nullif(btrim(p_contact->>'name'), ''), name),
      relationship = coalesce(nullif(btrim(p_contact->>'relationship'), ''), relationship),
      phone        = coalesce(nullif(btrim(p_contact->>'phone'), ''), phone),
      updated_by   = v_actor
    where patient_id = p_patient_id
      and (v_contact_id is null or id = v_contact_id);
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'no matching emergency contact for this patient' using errcode = 'PT404';
    end if;
  end if;

  if p_referral is not null then
    update public.patient_referrals set
      referrer_type  = coalesce(nullif(p_referral->>'referrer_type', '')::public.referrer_type, referrer_type),
      referrer_name  = case when p_referral ? 'referrer_name' then nullif(btrim(coalesce(p_referral->>'referrer_name', '')), '') else referrer_name end,
      referrer_phone = case when p_referral ? 'referrer_phone' then nullif(btrim(coalesce(p_referral->>'referrer_phone', '')), '') else referrer_phone end,
      updated_by     = v_actor
    where patient_id = p_patient_id
      and (nullif(p_referral->>'id', '') is null or id = (p_referral->>'id')::uuid);
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'no matching referral for this patient' using errcode = 'PT404';
    end if;
  end if;

  perform public.enqueue_record_mutation_audit(v_actor,(select public.current_app_role()),'patient_update','patient',p_patient_id,p_patient_id,
    jsonb_build_object('changed_fields',
      (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(coalesce(p_patient,'{}'::jsonb)) k)
      || case when p_responsible is not null then '["responsible"]'::jsonb else '[]'::jsonb end
      || case when p_medical_aid is not null then '["medical_aid"]'::jsonb else '[]'::jsonb end
      || case when p_contact is not null then '["contact"]'::jsonb else '[]'::jsonb end
      || case when p_referral is not null then '["referral"]'::jsonb else '[]'::jsonb end),p_ip_address,p_user_agent);
  return query
    select * from public.patients where id = p_patient_id;
end;
$$;

-- Defaults retain compatibility with three-argument callers.
drop function public.reassign_patient_hospital(uuid,text,text);
create or replace function public.reassign_patient_hospital(
  p_patient_id   uuid,
  p_new_hospital text,
  p_reason       text,
  p_ip_address   inet default null,
  p_user_agent   text default null
)
returns table (
  old_file_number text,
  new_file_number text,
  old_hospital    text,
  new_hospital    text,
  removed_pending_billing int
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.role_name;
  v_patient public.patients%rowtype;
  v_new_prefix text;
  v_new_number text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_removed int := 0;
  v_old_prefix text;
  v_old_year int;
  v_old_seq bigint;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_role := (select public.current_app_role());
  if v_role is null or v_role not in ('doctor', 'staff') then
    raise exception 'file reassignment is restricted to staff and doctor'
      using errcode = '42501';
  end if;

  if length(v_reason) < 10 then
    raise exception 'a reason of at least 10 characters is required'
      using errcode = '22023';
  end if;

  select * into v_patient
    from public.patients
    where id = p_patient_id
    for update;
  if not found then
    raise exception 'patient not found' using errcode = 'PT404';
  end if;

  if v_patient.hospital = p_new_hospital then
    raise exception 'patient is already filed under %', p_new_hospital
      using errcode = 'PT409';
  end if;

  select h.file_prefix into v_new_prefix
    from public.hospitals h
    where h.name = p_new_hospital
      and h.active;
  if v_new_prefix is null then
    raise exception 'Invalid or inactive hospital value: %', coalesce(p_new_hospital, 'null')
      using errcode = '22023';
  end if;

  -- New number under the correct prefix (consults reservations per 0040).
  v_new_number := public.allocate_file_number(null, v_new_prefix);

  -- Retire the old number: history row (search + traceability)…
  insert into public.patient_file_number_history (
    patient_id, old_file_number, old_hospital,
    new_file_number, new_hospital, reason, changed_by
  ) values (
    p_patient_id, v_patient.file_number, v_patient.hospital,
    v_new_number, p_new_hospital, v_reason, v_actor
  );

  -- …and a poison pill so the retired slot can never be re-issued through the
  -- reservations path. Parsed from the {PREFIX}-{YYYY}-{SEQ} format; a legacy
  -- number that does not parse simply skips this guard (the sequence counter
  -- is already past it and patients.file_number uniqueness still holds).
  if v_patient.file_number ~ '^[A-Z]{2,5}-\d{4}-\d+$' then
    v_old_prefix := split_part(v_patient.file_number, '-', 1);
    v_old_year   := split_part(v_patient.file_number, '-', 2)::int;
    v_old_seq    := split_part(v_patient.file_number, '-', 3)::bigint;
    insert into public.file_number_reservations (prefix, year, seq, reason, consumed_at)
    values (v_old_prefix, v_old_year, v_old_seq,
            'retired by hospital reassignment of patient ' || p_patient_id, now())
    on conflict (prefix, year, seq) do update
      set consumed_at = coalesce(public.file_number_reservations.consumed_at, now());
  end if;

  update public.patients
     set hospital = p_new_hospital,
         file_number = v_new_number,
         updated_by = v_actor
   where id = p_patient_id;

  -- Drop PENDING billing rows snapshotted under the wrong hospital. Exported
  -- and returned rows are part of the disclosure record and stay untouched.
  delete from public.billing_export_items b
   where b.patient_id = p_patient_id
     and b.hospital = v_patient.hospital
     and b.status = 'pending';
  get diagnostics v_removed = row_count;

  old_file_number := v_patient.file_number;
  new_file_number := v_new_number;
  old_hospital := v_patient.hospital;
  new_hospital := p_new_hospital;
  removed_pending_billing := v_removed;
  perform public.enqueue_record_mutation_audit(v_actor,v_role,'patient_file_reassigned','patient',p_patient_id,p_patient_id,
    jsonb_build_object('old_file_number',old_file_number,'new_file_number',new_file_number,
      'old_hospital',old_hospital,'new_hospital',new_hospital,'removed_pending_billing',removed_pending_billing,'reason',v_reason),p_ip_address,p_user_agent);
  return next;
end;
$$;

-- Preserve only the existing browser-callable controlled operations.
revoke all on function public.update_patient_bundle(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,inet,text) from public,anon;
grant execute on function public.update_patient_bundle(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,inet,text) to authenticated;
revoke all on function public.reassign_patient_hospital(uuid,text,text,inet,text) from public,anon;
grant execute on function public.reassign_patient_hospital(uuid,text,text,inet,text) to authenticated;
-- Preserve the existing operator-only cleanup of disposable test patients.
create or replace function public.hard_delete_patient_data(p_patient_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_patient_id is null then
    raise exception 'p_patient_id is required' using errcode = '22023';
  end if;

  delete from break_glass_requests where target_patient_id = p_patient_id;
  delete from clinical_notes where patient_id = p_patient_id;
  delete from patient_encryption_keys where patient_id = p_patient_id;
  delete from public.document_upload_intents where patient_id = p_patient_id;
  delete from patient_documents where patient_id = p_patient_id;
  delete from consent_records where patient_id = p_patient_id;
  delete from patient_dependants where patient_id = p_patient_id;
  delete from patient_referrals where patient_id = p_patient_id;
  delete from patient_emergency_contacts where patient_id = p_patient_id;
  delete from patient_medical_aid where patient_id = p_patient_id;
  delete from patient_account_responsible where patient_id = p_patient_id;

  -- Audit logs are append-only and intentionally retained.
  delete from patients where id = p_patient_id;
end;
$$;


revoke all on function public.hard_delete_patient_data(uuid) from public,anon,authenticated;
grant execute on function public.hard_delete_patient_data(uuid) to service_role;
commit;
