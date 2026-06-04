-- 0036_billing_export_items.sql — Monthly billing export staging + items.
--
-- Feature: staff (and the doctor) curate a per-hospital, per-month batch of
-- patient files to hand to the third-party billing company, then generate a
-- spreadsheet populated with File Number, Name, ID/Passport and Medical Aid
-- Number (auto-filled from the patient record) plus a shared outgoing date and
-- an optional returned date.
--
-- DESIGN CONSTRAINTS HONOURED (see the feature's Constraints preamble):
--   1.1  No trigger is added on this table. `updated_at` is maintained
--        explicitly in the write paths (the RPC below + the API route updates),
--        the same incident-safe way the rest of the app avoids audit/updated_at
--        trigger amplification. Audit rows are written ONLY through the existing
--        SECURITY DEFINER function write_audit_entry_atomic (from the route).
--   1.5  No service_role grant is added or widened. Reads/writes happen under
--        the caller's authenticated RLS context; the only SECURITY DEFINER here
--        is a self-contained upsert that re-checks the caller's app role.
--   3.4  Nav visibility and RLS agree: doctor + staff may read/write; admin is
--        excluded (admin has no demographic read per the authz matrix).
--   4    Hard UNIQUE (patient_id, hospital, export_month) + INSERT ... ON
--        CONFLICT DO UPDATE so re-staging/re-export never duplicates a row.
--        export_month is constrained to the first day of the month.
--   1.4  This table holds billing fields only. It never references clinical
--        note content; clinical_notes RLS is untouched.

begin;

set statement_timeout = 0;

-- Lifecycle of a staged file within a month's outgoing batch.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'billing_export_status') then
    create type billing_export_status as enum ('pending', 'exported', 'returned');
  end if;
end $$;

create table if not exists public.billing_export_items (
  id                 uuid primary key default gen_random_uuid(),
  patient_id         uuid not null references public.patients(id) on delete restrict,
  -- The "practice" grain. There is no practice_id in this single-practice app;
  -- patients.hospital (mandatory, CHECK-constrained, set at onboarding) is the
  -- clean filter key. Snapshotted here so the export is reconstructable even if
  -- a patient record changes later.
  hospital           text not null,
  export_month       date not null,                 -- first day of the month
  -- Billing fields, snapshotted from the patient record at stage/refresh time.
  file_number        text,
  patient_name       text not null,                 -- "FIRST [MIDDLE] SURNAME"
  id_number          text,                          -- SA ID or passport (plaintext at rest)
  id_type            public.id_type,
  medical_aid_number text,
  -- Batch metadata.
  outgoing_date      date,                          -- shared date the batch was sent
  returned_date      date,                          -- blank until files come back
  status             public.billing_export_status not null default 'pending',
  exported_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.app_users(id),
  updated_by         uuid references public.app_users(id),
  constraint billing_export_items_hospital_allowed check (hospital in (
    'Nkanyezi Private Hospital',
    'Fountain Private Hospital',
    'Mediclinic Vereeniging Hospital',
    'Midvaal Private Hospital'
  )),
  constraint billing_export_items_month_is_first_day
    check (export_month = date_trunc('month', export_month)::date),
  constraint billing_export_items_unique unique (patient_id, hospital, export_month)
);

create index if not exists billing_export_items_month_idx
  on public.billing_export_items (hospital, export_month);
create index if not exists billing_export_items_patient_idx
  on public.billing_export_items (patient_id);

comment on table public.billing_export_items is
  'Per-hospital, per-month staged billing rows for the third-party billing company. '
  'Billing fields only — never clinical content. updated_at is set explicitly in the '
  'write path (no trigger, per the audit-amplification incident remediation).';

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- doctor + staff may read/write billing rows; admin and anon get nothing.
-- Predicate uses the optimized (select current_app_role()) initPlan form (0033).
alter table public.billing_export_items enable row level security;

create policy billing_export_items_clinical_read on public.billing_export_items
  for select to authenticated
  using ((select public.current_app_role()) in ('doctor'::public.role_name, 'staff'::public.role_name));

create policy billing_export_items_clinical_insert on public.billing_export_items
  for insert to authenticated
  with check ((select public.current_app_role()) in ('doctor'::public.role_name, 'staff'::public.role_name));

create policy billing_export_items_clinical_update on public.billing_export_items
  for update to authenticated
  using ((select public.current_app_role()) in ('doctor'::public.role_name, 'staff'::public.role_name))
  with check ((select public.current_app_role()) in ('doctor'::public.role_name, 'staff'::public.role_name));

create policy billing_export_items_clinical_delete on public.billing_export_items
  for delete to authenticated
  using ((select public.current_app_role()) in ('doctor'::public.role_name, 'staff'::public.role_name));

-- Minimum grants for RLS-governed access. NO service_role grant (Constraints 1.5):
-- the server runs these operations under the caller's authenticated client.
revoke all on public.billing_export_items from anon;
grant select, insert, update, delete on public.billing_export_items to authenticated;

-- ── Staging upsert ────────────────────────────────────────────────────────────
-- Bulk-stage (or refresh) patient files into a month's batch. SECURITY DEFINER so
-- it can read the patient + medical-aid snapshot in one place and auto-populate
-- the billing fields server-side — that auto-population is the actual point of
-- the feature (Constraints 3.2). It re-checks the caller's app role so it cannot
-- be abused outside the doctor/staff posture, and it preserves created_* on
-- conflict while bumping updated_* explicitly (no trigger).
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
  v_role  public.role_name;
  v_count integer;
begin
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
    id_number, id_type, medical_aid_number, status,
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
    'pending'::public.billing_export_status,
    p_actor_user_id,
    p_actor_user_id,
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
        updated_by         = excluded.updated_by,
        updated_at         = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.stage_billing_export_items(uuid, text, date, uuid[]) from public;
grant execute on function public.stage_billing_export_items(uuid, text, date, uuid[]) to authenticated;

commit;
