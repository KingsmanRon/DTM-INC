-- 0059_patient_insurance_fields.sql
--
-- US insurance capture. A US payer is an insurance plan with a group number and
-- a subscriber relationship that SA medical-aid never modelled. Add both to
-- patient_medical_aid (reused for both locales) — nullable/additive, so SA rows
-- are unaffected. The existing columns are reused per locale (the wizard labels
-- them): medical_aid_name = carrier/payer, membership_number = subscriber ID,
-- main_member_name = subscriber name, plan = plan name.
--
-- Scope: PRIMARY insurance only. Secondary insurance, insurance-card images (via
-- the existing documents flow), and 270/271 real-time eligibility are later
-- slices.

alter table public.patient_medical_aid
  add column if not exists group_number text;

alter table public.patient_medical_aid
  add column if not exists subscriber_relationship text;

alter table public.patient_medical_aid
  drop constraint if exists patient_medical_aid_subscriber_relationship_check;
alter table public.patient_medical_aid
  add constraint patient_medical_aid_subscriber_relationship_check
  check (
    subscriber_relationship is null
    or subscriber_relationship in ('self', 'spouse', 'child', 'other')
  );

comment on column public.patient_medical_aid.group_number is
  'US insurance group number (null for SA medical-aid rows).';
comment on column public.patient_medical_aid.subscriber_relationship is
  'US insured''s relationship to the subscriber: self|spouse|child|other (null for SA).';
