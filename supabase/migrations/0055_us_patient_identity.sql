-- 0055_us_patient_identity.sql
--
-- Schema foundation for locale "us" patient identity. The US has no national ID
-- number, so identity anchors on name + date_of_birth, with the last 4 of the
-- SSN as an OPTIONAL disambiguator (the full SSN is never stored — see
-- src/lib/validation/us-identity.ts).
--
-- ALL CHANGES ARE ADDITIVE AND NULLABLE so existing SA single-tenant
-- deployments are completely unaffected: SA patient rows keep id_type
-- sa_id/passport/none_minor with a populated id_number and a NULL
-- date_of_birth/ssn_last4, and continue to satisfy the (now more permissive)
-- identity CHECK unchanged.
--
-- NOT in this slice: onboard_patient still rejects 'none' (it is the next
-- migration). This file only makes the schema *able* to hold a US patient; it
-- does not yet create one.

begin;

-- 1) Identity columns. date_of_birth is the US identity anchor; ssn_last4 is an
--    optional 4-digit disambiguator. Both NULL for every existing SA row.
alter table public.patients
  add column if not exists date_of_birth date;

alter table public.patients
  add column if not exists ssn_last4 text;

-- ssn_last4 must be exactly 4 digits when present. The column is brand new (all
-- NULL), so this validates instantly.
alter table public.patients
  drop constraint if exists patients_ssn_last4_format;
alter table public.patients
  add constraint patients_ssn_last4_format
  check (ssn_last4 is null or ssn_last4 ~ '^\d{4}$');

-- 2) Extend the identity guardrail (originally 0017) with a US branch. The
--    first two branches are 0017 verbatim (SA adult / SA minor); the third
--    allows the US shape: id_type 'none', no national id_number, DOB present.
--    Uses id_type::text so the 'none' value added in 0054 needs no enum literal
--    here. NOT VALID skips a rescan of existing rows — they already satisfy the
--    stricter old rule, which this only widens — while still enforcing every
--    new insert/update.
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
    or
    (
      -- US / no-national-id identity (locale "us"): the anchor is name +
      -- date_of_birth, no national id_number. Applies to adults and minors
      -- alike (US minors carry no national ID either; the guardian requirement
      -- is enforced in the onboarding RPC, not in this table CHECK).
      id_type::text = 'none'
      and coalesce(btrim(id_number), '') = ''
      and date_of_birth is not null
    )
  )
  not valid;

comment on constraint patients_identity_minor_guardrails on public.patients is
  'SA adults: SA ID/passport + number. SA minors: none_minor or SA ID/passport. US (id_type none): name + date_of_birth, no national ID. Text comparison so new enum values stay add-then-use safe.';

-- 3) Duplicate-patient support for US — DELIBERATELY NOT A UNIQUE CONSTRAINT.
--    Unlike an SA national ID (unique → hard unique index in 0031), name + DOB
--    is NOT unique in reality: distinct people legitimately share them. A hard
--    constraint would block registering a real second patient. So US duplicate
--    handling is SOFT: the app looks up likely matches on (date_of_birth,
--    surname) and warns the user, who can confirm or override. This non-unique
--    index just makes that lookup fast. SSN last-4, when present, further
--    disambiguates in the app — it is not part of the index.
create index if not exists patients_us_identity_lookup
  on public.patients (date_of_birth, lower(surname))
  where date_of_birth is not null;

comment on index public.patients_us_identity_lookup is
  'Fast soft-duplicate lookup for US patients (name + DOB). Non-unique on purpose: name+DOB collisions are legitimate, so duplicates are warned, not blocked.';

commit;
