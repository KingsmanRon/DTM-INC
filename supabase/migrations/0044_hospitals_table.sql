-- 0044_hospitals_table.sql — make the hospital list + file-number prefix map data, not code.
--
-- WHY (v2 repackaging): the hospital→prefix mapping lived in FOUR+ hardcoded
-- places (the jsonb constant inside onboard_patient, HospitalEnum in
-- src/lib/validation/patient.ts, BILLING_HOSPITALS/HOSPITAL_FILE_PREFIX in
-- src/lib/billing/format.ts, PRACTICES in patient-search.tsx, plus CHECK
-- constraints on patients and billing_export_items). A new practice admits at
-- different hospitals, so every deployment would have required coordinated SQL
-- + code edits. This table becomes the single source of truth; the app reads it
-- (RLS SELECT for authenticated) and onboard_patient (0045) resolves prefixes
-- from it — still hard-failing on unknown/inactive hospitals, preserving the
-- "no silent default prefix" invariant.
--
-- Deactivation model: set active = false to stop NEW onboarding at a hospital
-- while every existing patient/billing row stays valid (FKs are RESTRICT — a
-- referenced hospital row can never be deleted).

begin;

create table if not exists public.hospitals (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  file_prefix   text not null unique,
  active        boolean not null default true,
  display_order int not null default 100,
  created_at    timestamptz not null default now(),
  constraint hospitals_prefix_format check (file_prefix ~ '^[A-Z]{2,5}$')
);

comment on table public.hospitals is
  'Hospitals this practice admits at, with their file-number prefixes. Single '
  'source of truth consumed by onboard_patient() (0045), the onboarding/billing '
  'validation, and the UI dropdowns. Deactivate (active=false) instead of '
  'deleting; FKs from patients/billing_export_items are ON DELETE RESTRICT.';

insert into public.hospitals (name, file_prefix, display_order) values
  ('Nkanyezi Private Hospital',         'NKA', 10),
  ('Fountain Private Hospital',         'FOU', 20),
  ('Mediclinic Vereeniging Hospital',   'MED', 30),
  ('Midvaal Private Hospital',          'MID', 40)
on conflict (name) do nothing;

-- RLS: every authenticated user may read (the list is practice metadata, not
-- PHI — dropdowns need it); nobody writes through the API in v1 (operator-managed).
alter table public.hospitals enable row level security;

create policy hospitals_read on public.hospitals
  for select to authenticated using (true);

revoke all on public.hospitals from anon;
grant select on public.hospitals to authenticated;

-- Replace the hardcoded CHECK constraints with FKs to the table. The four
-- seeded names match every existing row, so validation passes as-is.
alter table public.patients
  drop constraint if exists patients_hospital_allowed_values;
alter table public.patients
  add constraint patients_hospital_fkey
  foreign key (hospital) references public.hospitals(name)
  on update restrict on delete restrict;

alter table public.billing_export_items
  drop constraint if exists billing_export_items_hospital_allowed;
alter table public.billing_export_items
  add constraint billing_export_items_hospital_fkey
  foreign key (hospital) references public.hospitals(name)
  on update restrict on delete restrict;

commit;

-- POST-APPLY VERIFICATION:
--   1. select name, file_prefix, active from public.hospitals order by display_order; -> 4 rows.
--   2. Onboarding at each hospital still allocates the matching prefix (after 0045).
--   3. insert into patients(... hospital => 'Bogus Hospital' ...) -> FK violation.
--   4. As a NEW practice: insert your hospitals here, no code change needed.
