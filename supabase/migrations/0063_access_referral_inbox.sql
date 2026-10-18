-- 0063_access_referral_inbox.sql — inbox for referrals delivered by ACCESS.
--
-- ACCESS (KingsmanRon/Appointments) takes in referrals, checks they are
-- administratively complete, then delivers them here through the signed
-- integration API (/api/v1/integrations/access, docs/integrations/access.md).
-- A delivered referral waits in this inbox until reception either:
--   * accepts it: links it to an existing patient file, which records a
--     patient_referrals row; a new patient is onboarded first, in person,
--     because Section G consent needs the patient present; or
--   * declines it, with a reason.
--
-- ACCESS never creates, edits or reads patient files, and read-back returns
-- only the inbox reference and status: no patient data flows back to ACCESS.
--
-- Writes happen only through the four functions below:
--   receive_access_referral / read_access_referral  service_role (integration API)
--   accept_access_referral  / decline_access_referral  doctor + staff
-- No API role may insert, update or delete inbox rows directly.
--
-- Depends on 0062 (audit action values), which must be applied first.

begin;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'access_inbox_status') then
    create type public.access_inbox_status as enum ('pending', 'accepted', 'declined');
  end if;
  if not exists (select 1 from pg_type where typname = 'access_data_mode') then
    create type public.access_data_mode as enum ('synthetic', 'real');
  end if;
end $$;

create sequence if not exists public.access_referral_inbox_number_seq;

create table if not exists public.access_referral_inbox (
  id                    uuid primary key default gen_random_uuid(),
  -- Human reference reception can quote back to ACCESS ("IN-000042").
  reference             text not null unique
                        default ('IN-' || lpad(nextval('public.access_referral_inbox_number_seq')::text, 6, '0')),
  -- Idempotency key: one ACCESS execution delivers at most one inbox row.
  access_execution_id   uuid not null unique,
  access_correlation_id uuid not null,
  access_tenant_id      uuid not null,
  access_case_reference text not null check (access_case_reference ~ '^REF-[0-9A-F]{8}$'),
  access_referral_id    uuid not null,
  data_mode             public.access_data_mode not null,
  payload_sha256        text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  -- The referral as ACCESS delivered it: the minimum reception needs.
  patient_given_name    text not null check (char_length(patient_given_name) between 1 and 200),
  patient_family_name   text not null check (char_length(patient_family_name) between 1 and 200),
  patient_date_of_birth date not null,
  patient_identifier    text check (patient_identifier is null or char_length(patient_identifier) between 1 and 100),
  referrer_name         text not null check (char_length(referrer_name) between 1 and 200),
  reason                text check (reason is null or char_length(reason) <= 4000),
  requested_service     text check (requested_service is null or requested_service ~ '^[A-Z0-9_]{2,64}$'),
  referral_date         date,
  funding_type          text check (funding_type is null or funding_type in ('MEDICAL_AID', 'SELF_PAY', 'OTHER', 'UNKNOWN')),
  funding_scheme        text check (funding_scheme is null or char_length(funding_scheme) <= 120),
  documents_held        text[] not null default '{}',
  received_at           timestamptz not null,
  delivered_at          timestamptz not null default now(),
  -- Exactly one active file with the same ID/passport number, if any. A
  -- suggestion for reception, never an automatic link.
  suggested_patient_id  uuid references public.patients(id) on delete restrict,
  status                public.access_inbox_status not null default 'pending',
  linked_patient_id     uuid references public.patients(id) on delete restrict,
  linked_referral_id    uuid references public.patient_referrals(id) on delete restrict,
  decline_reason        text check (decline_reason is null or char_length(decline_reason) between 3 and 500),
  resolved_at           timestamptz,
  resolved_by           uuid references public.app_users(id),
  constraint access_referral_inbox_resolution check (
       (status = 'pending'
        and linked_patient_id is null and linked_referral_id is null
        and decline_reason is null and resolved_at is null and resolved_by is null)
    or (status = 'accepted'
        and linked_patient_id is not null and linked_referral_id is not null
        and decline_reason is null and resolved_at is not null and resolved_by is not null)
    or (status = 'declined'
        and linked_patient_id is null and linked_referral_id is null
        and decline_reason is not null and resolved_at is not null and resolved_by is not null)
  )
);

create index if not exists access_referral_inbox_status_idx
  on public.access_referral_inbox (status, delivered_at desc);

comment on table public.access_referral_inbox is
  'Referrals delivered by the ACCESS integration, waiting for reception to link them to a '
  'patient file or decline them. Written only by the receive/accept/decline functions.';

-- ── RLS and grants ───────────────────────────────────────────────────────────
-- doctor + staff may read (the same audience as patient demographics); admin,
-- anon and the service role get nothing directly.
alter table public.access_referral_inbox enable row level security;

drop policy if exists access_referral_inbox_clinical_read on public.access_referral_inbox;
create policy access_referral_inbox_clinical_read on public.access_referral_inbox
  for select to authenticated
  using ((select public.current_app_role()) in ('doctor'::public.role_name, 'staff'::public.role_name));

revoke all on public.access_referral_inbox from public, anon, authenticated, service_role;
grant select on public.access_referral_inbox to authenticated;
revoke all on sequence public.access_referral_inbox_number_seq from public, anon, authenticated, service_role;

-- ── Integration API (service_role only) ─────────────────────────────────────

-- Store a delivery once per ACCESS execution id. A repeat with the same
-- payload hash is a replay (deduplicated); a repeat with a different hash is
-- reported as a conflict and stores nothing new.
create or replace function public.receive_access_referral(
  p_execution_id   uuid,
  p_correlation_id uuid,
  p_tenant_id      uuid,
  p_data_mode      public.access_data_mode,
  p_payload_sha256 text,
  p_referral       jsonb
)
returns table (
  id           uuid,
  reference    text,
  status       public.access_inbox_status,
  delivered_at timestamptz,
  deduplicated boolean,
  conflict     boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_row        public.access_referral_inbox%rowtype;
  v_identifier text := nullif(upper(btrim(p_referral #>> '{patient,identifier}')), '');
  v_matches    uuid[];
begin
  if p_execution_id is null or p_correlation_id is null or p_tenant_id is null
     or p_data_mode is null or p_payload_sha256 is null or p_referral is null then
    raise exception 'execution, correlation, tenant, data mode, payload hash and referral are required'
      using errcode = '22023';
  end if;

  -- One exact, active identity match or none: never a guess between files.
  if v_identifier is not null then
    select array_agg(p.id) into v_matches
      from public.patients p
     where upper(btrim(p.id_number)) = v_identifier
       and p.status = 'active';
  end if;

  insert into public.access_referral_inbox (
    access_execution_id, access_correlation_id, access_tenant_id,
    access_case_reference, access_referral_id, data_mode, payload_sha256,
    patient_given_name, patient_family_name, patient_date_of_birth, patient_identifier,
    referrer_name, reason, requested_service, referral_date, funding_type, funding_scheme,
    documents_held, received_at, suggested_patient_id
  ) values (
    p_execution_id, p_correlation_id, p_tenant_id,
    p_referral ->> 'case_reference', (p_referral ->> 'referral_id')::uuid, p_data_mode, p_payload_sha256,
    p_referral #>> '{patient,given_name}', p_referral #>> '{patient,family_name}',
    (p_referral #>> '{patient,date_of_birth}')::date, v_identifier,
    p_referral #>> '{referrer,name}', nullif(p_referral ->> 'reason', ''),
    nullif(p_referral ->> 'requested_service', ''), nullif(p_referral ->> 'referral_date', '')::date,
    nullif(p_referral #>> '{funding,type}', ''), nullif(p_referral #>> '{funding,scheme}', ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_referral -> 'documents_held', '[]'::jsonb))), '{}'),
    (p_referral ->> 'received_at')::timestamptz,
    case when cardinality(v_matches) = 1 then v_matches[1] end
  )
  on conflict (access_execution_id) do nothing
  returning * into v_row;

  if found then
    return query select v_row.id, v_row.reference, v_row.status, v_row.delivered_at, false, false;
    return;
  end if;

  select * into v_row
    from public.access_referral_inbox i
   where i.access_execution_id = p_execution_id;
  return query select v_row.id, v_row.reference, v_row.status, v_row.delivered_at, true,
    v_row.payload_sha256 is distinct from p_payload_sha256;
end;
$$;

-- Read-back by ACCESS execution id (or by inbox reference). Returns no
-- patient data: reference, status and times only.
create or replace function public.read_access_referral(
  p_execution_id uuid default null,
  p_reference    text default null
)
returns table (
  execution_id uuid,
  reference    text,
  status       public.access_inbox_status,
  delivered_at timestamptz,
  resolved_at  timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.access_execution_id, i.reference, i.status, i.delivered_at, i.resolved_at
    from public.access_referral_inbox i
   where (p_execution_id is not null and i.access_execution_id = p_execution_id)
      or (p_reference is not null and i.reference = p_reference)
   limit 1;
$$;

revoke all on function public.receive_access_referral(uuid, uuid, uuid, public.access_data_mode, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.receive_access_referral(uuid, uuid, uuid, public.access_data_mode, text, jsonb)
  to service_role;
revoke all on function public.read_access_referral(uuid, text) from public, anon, authenticated;
grant execute on function public.read_access_referral(uuid, text) to service_role;

-- ── Reception actions (doctor + staff, under their own session) ─────────────

-- Link a pending referral to an existing, active patient file. Records the
-- referral on the patient (patient_referrals) and closes the inbox item in
-- one transaction.
create or replace function public.accept_access_referral(
  p_inbox_id      uuid,
  p_patient_id    uuid,
  p_referrer_type public.referrer_type
)
returns table (
  referral_id uuid,
  patient_id  uuid,
  reference   text
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
#variable_conflict use_column
declare
  v_actor       uuid := auth.uid();
  v_role        public.role_name;
  v_item        public.access_referral_inbox%rowtype;
  v_patient     public.patients%rowtype;
  v_referral_id uuid;
  v_notes       text;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_role := (select public.current_app_role());
  if v_role is null or v_role not in ('doctor', 'staff') then
    raise exception 'accepting ACCESS referrals is restricted to staff and doctor'
      using errcode = '42501';
  end if;

  if p_referrer_type is null or p_referrer_type = 'self' then
    raise exception 'choose who referred the patient' using errcode = '22023';
  end if;

  select * into v_item
    from public.access_referral_inbox i
   where i.id = p_inbox_id
     for update;
  if not found then
    raise exception 'inbox referral not found' using errcode = 'PT404';
  end if;
  if v_item.status <> 'pending' then
    raise exception 'inbox referral is already %', v_item.status using errcode = 'PT409';
  end if;

  select * into v_patient from public.patients p where p.id = p_patient_id;
  if not found then
    raise exception 'patient not found' using errcode = 'PT404';
  end if;
  if v_patient.status <> 'active' then
    raise exception 'patient file is archived' using errcode = 'PT409';
  end if;

  v_notes := concat_ws(E'\n',
    format('Received via ACCESS: %s (inbox %s).', v_item.access_case_reference, v_item.reference),
    case when v_item.requested_service is not null then 'Requested service: ' || v_item.requested_service end,
    case when v_item.reason is not null then 'Reason: ' || v_item.reason end);

  insert into public.patient_referrals (
    patient_id, referrer_type, referrer_name, referrer_phone, referral_notes, created_by, updated_by
  ) values (
    v_patient.id, p_referrer_type, v_item.referrer_name, null, v_notes, v_actor, v_actor
  )
  returning id into v_referral_id;

  update public.access_referral_inbox i
     set status = 'accepted',
         linked_patient_id = v_patient.id,
         linked_referral_id = v_referral_id,
         resolved_at = now(),
         resolved_by = v_actor
   where i.id = v_item.id;

  return query select v_referral_id, v_patient.id, v_item.reference;
end;
$$;

-- Decline a pending referral with a reason (for example: not this practice's
-- speciality, or a duplicate of one already filed).
create or replace function public.decline_access_referral(
  p_inbox_id uuid,
  p_reason   text
)
returns table (
  reference text
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
#variable_conflict use_column
declare
  v_actor  uuid := auth.uid();
  v_role   public.role_name;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_item   public.access_referral_inbox%rowtype;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_role := (select public.current_app_role());
  if v_role is null or v_role not in ('doctor', 'staff') then
    raise exception 'declining ACCESS referrals is restricted to staff and doctor'
      using errcode = '42501';
  end if;

  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'a reason of 3 to 500 characters is required' using errcode = '22023';
  end if;

  select * into v_item
    from public.access_referral_inbox i
   where i.id = p_inbox_id
     for update;
  if not found then
    raise exception 'inbox referral not found' using errcode = 'PT404';
  end if;
  if v_item.status <> 'pending' then
    raise exception 'inbox referral is already %', v_item.status using errcode = 'PT409';
  end if;

  update public.access_referral_inbox i
     set status = 'declined',
         decline_reason = v_reason,
         resolved_at = now(),
         resolved_by = v_actor
   where i.id = v_item.id;

  return query select v_item.reference;
end;
$$;

revoke all on function public.accept_access_referral(uuid, uuid, public.referrer_type)
  from public, anon, service_role;
grant execute on function public.accept_access_referral(uuid, uuid, public.referrer_type)
  to authenticated;
revoke all on function public.decline_access_referral(uuid, text) from public, anon, service_role;
grant execute on function public.decline_access_referral(uuid, text) to authenticated;

commit;
