-- DTM Inc. PWA — initial schema
-- POPIA s.26/s.27 (special personal information) compliant structure.
-- All patient-scoped tables are RLS-protected. See §10.1–§10.5 of the spec.
--
-- Conventions:
--   * uuid v4 PKs
--   * timestamptz everywhere
--   * FKs default to ON DELETE RESTRICT (soft delete only — §4.6)
--   * updated_at maintained by trigger
--   * no application role has UPDATE/DELETE on audit_logs

set statement_timeout = 0;
set lock_timeout = 0;
set idle_in_transaction_session_timeout = 0;
set client_encoding = 'UTF8';
set standard_conforming_strings = on;

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";
create extension if not exists "uuid-ossp";

-- ═══════════════════════════════════════════════════════════════════════════
-- ENUMS
-- ═══════════════════════════════════════════════════════════════════════════

create type role_name      as enum ('doctor', 'staff', 'admin');
create type user_status    as enum ('active', 'deactivated', 'pending_invite');
create type id_type        as enum ('sa_id', 'passport');
create type payer_type     as enum ('medical_aid', 'private');
create type patient_status as enum ('active', 'archived');
create type title_enum     as enum ('Mr', 'Mrs', 'Miss', 'Dr', 'Prof', 'Other');
create type marital_status as enum ('single', 'married', 'divorced', 'widowed');
create type sex_enum       as enum ('m', 'f', 'other');
create type referrer_type  as enum ('gp', 'specialist', 'self', 'other');
create type doc_category   as enum (
  'id_copy', 'medical_aid_card', 'consent_form', 'referral_letter',
  'pathology_result', 'imaging_report', 'correspondence', 'other'
);
create type signature_type as enum ('typed_name', 'drawn_signature');
create type audit_action   as enum (
  'login_success', 'login_failure', 'login_lockout', 'logout',
  'patient_create', 'patient_update', 'patient_archive',
  'document_upload', 'document_view', 'document_download', 'document_archive',
  'note_create', 'note_read', 'note_amend', 'note_finalise',
  'user_create', 'user_deactivate', 'user_reset_mfa', 'permission_change',
  'practice_settings_update', 'onboarding_pdf_generate',
  'break_glass_request', 'break_glass_access',
  'consent_capture'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLES & USERS
-- ═══════════════════════════════════════════════════════════════════════════

create table roles (
  id          uuid primary key default gen_random_uuid(),
  name        role_name not null unique,
  description text
);

insert into roles (name, description) values
  ('doctor', 'Dr. Thomas Mtshali — sole clinician. Read/write clinical notes.'),
  ('staff',  'Reception. Demographics, documents, consent. NEVER clinical notes.'),
  ('admin',  'User & practice settings management. Break-glass only for notes.');

-- app_users mirrors auth.users (Supabase Auth) with our role + profile.
-- 1:1 via id column. Row-level security filters clinical-notes exposure.
create table app_users (
  id                   uuid primary key,  -- matches auth.users.id
  email                text not null unique,
  full_name            text not null,
  role_id              uuid not null references roles(id) on delete restrict,
  mfa_enabled          boolean not null default false,
  mfa_enrolled_at      timestamptz,
  status               user_status not null default 'pending_invite',
  last_login_at        timestamptz,
  failed_login_count   int not null default 0,
  locked_until         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references app_users(id),
  updated_by           uuid references app_users(id)
);

create index app_users_role_idx on app_users(role_id);
create index app_users_status_idx on app_users(status);

-- ═══════════════════════════════════════════════════════════════════════════
-- PATIENTS & FILE NUMBERS
-- ═══════════════════════════════════════════════════════════════════════════

-- Per-year sequence table for atomic file-number generation (§FR-4).
-- Uses SELECT ... FOR UPDATE in the allocator function to guarantee no collision.
create table file_number_sequences (
  year       int primary key,
  next_value bigint not null default 1
);

create table patients (
  id             uuid primary key default gen_random_uuid(),
  file_number    text not null unique,
  title          title_enum not null,
  first_names    text not null,
  surname        text not null,
  id_number      text not null,
  id_type        id_type not null default 'sa_id',
  id_country     text,                         -- ISO 3166-1 alpha-2, for passports
  email          text,
  phone          text not null,                -- E.164
  address        text not null,
  payer_type     payer_type not null default 'medical_aid',
  status         patient_status not null default 'active',
  archived_at    timestamptz,
  archived_by    uuid references app_users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references app_users(id),
  updated_by     uuid references app_users(id)
);

-- Search indexes (§FR-5)
create index patients_surname_trgm      on patients using gin (surname gin_trgm_ops);
create index patients_first_names_trgm  on patients using gin (first_names gin_trgm_ops);
create index patients_file_number_idx   on patients (file_number);
create index patients_id_number_idx     on patients (id_number);
create index patients_phone_idx         on patients (phone);
create index patients_status_idx        on patients (status);

-- ═══════════════════════════════════════════════════════════════════════════
-- PATIENT SUB-RESOURCES
-- ═══════════════════════════════════════════════════════════════════════════

create table patient_account_responsible (
  id                       uuid primary key default gen_random_uuid(),
  patient_id               uuid not null unique references patients(id) on delete restrict,
  same_as_patient          boolean not null default false,
  title                    title_enum not null,
  first_names              text not null,
  surname                  text not null,
  id_number                text not null,
  date_of_birth            date not null,
  marital_status           marital_status not null,
  email                    text,
  phone                    text not null,
  home_address             text not null,
  spouse_partner_phone     text,
  spouse_partner_work_phone text,
  employer_name            text,
  occupation               text,
  work_address             text,
  work_phone               text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid references app_users(id),
  updated_by               uuid references app_users(id)
);

create table patient_medical_aid (
  id                   uuid primary key default gen_random_uuid(),
  patient_id           uuid not null unique references patients(id) on delete restrict,
  same_as_responsible  boolean not null default true,
  main_member_name     text,
  medical_aid_name     text,                   -- FREE TEXT (§15, no dropdown)
  membership_number    text,
  plan                 text,
  other_plan_detail    text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references app_users(id),
  updated_by           uuid references app_users(id)
);

create table patient_emergency_contacts (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references patients(id) on delete restrict,
  name          text not null,
  relationship  text not null,
  address       text,
  email         text,
  phone         text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references app_users(id),
  updated_by    uuid references app_users(id)
);

create index patient_emergency_contacts_patient_idx on patient_emergency_contacts(patient_id);

create table patient_referrals (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references patients(id) on delete restrict,
  referrer_type  referrer_type not null,
  referrer_name  text,
  referrer_phone text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references app_users(id),
  updated_by     uuid references app_users(id)
);

create index patient_referrals_patient_idx on patient_referrals(patient_id);

create table patient_dependants (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references patients(id) on delete restrict,
  name            text not null,
  sex             sex_enum not null,
  date_of_birth   date not null,
  dependant_code  text not null,
  allergies       text,
  archived_at     timestamptz,
  archived_by     uuid references app_users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references app_users(id),
  updated_by      uuid references app_users(id)
);

create index patient_dependants_patient_idx on patient_dependants(patient_id);

-- Consent records are IMMUTABLE (§FR-3 Section G). No updates — new rows only.
create table consent_records (
  id                          uuid primary key default gen_random_uuid(),
  patient_id                  uuid not null references patients(id) on delete restrict,
  consent_text_version        text not null,
  consent_text_hash           text not null,     -- sha256 hex of displayed text
  accepted_by_user_id         uuid not null references app_users(id),
  accepted_at                 timestamptz not null default now(),
  signature_type              signature_type not null,
  signature_value             text not null,     -- typed name OR base64 PNG
  patient_present_attestation boolean not null
);

create index consent_records_patient_idx on consent_records(patient_id, accepted_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- DOCUMENTS (§FR-9)
-- ═══════════════════════════════════════════════════════════════════════════

create table patient_documents (
  id                uuid primary key default gen_random_uuid(),
  patient_id        uuid not null references patients(id) on delete restrict,
  category          doc_category not null,
  storage_key       text not null,            -- non-guessable key in Supabase Storage
  original_filename text not null,
  mime_type         text not null,
  file_size         bigint not null,
  sha256_hash       text not null,
  uploaded_by       uuid not null references app_users(id),
  uploaded_at       timestamptz not null default now(),
  archived_at       timestamptz,
  archived_by       uuid references app_users(id)
);

create index patient_documents_patient_idx on patient_documents(patient_id, uploaded_at desc);
create index patient_documents_category_idx on patient_documents(patient_id, category);

-- ═══════════════════════════════════════════════════════════════════════════
-- CLINICAL NOTES + ENVELOPE ENCRYPTION (§FR-8, §10.3)
-- ═══════════════════════════════════════════════════════════════════════════

-- One DEK per patient, wrapped by a KMS-managed KEK.
create table patient_encryption_keys (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null unique references patients(id) on delete restrict,
  wrapped_dek bytea not null,
  kek_id      text not null,                   -- reference to KMS key version
  created_at  timestamptz not null default now(),
  rotated_at  timestamptz
);

create table clinical_notes (
  id                    uuid primary key default gen_random_uuid(),
  patient_id            uuid not null references patients(id) on delete restrict,
  author_user_id        uuid not null references app_users(id),
  note_date             date not null default current_date,
  encrypted_body        bytea not null,
  nonce                 bytea not null,           -- 12 bytes for AES-256-GCM
  dek_id                uuid not null references patient_encryption_keys(id),
  is_finalised          boolean not null default false,
  finalised_at          timestamptz,
  amended_from_note_id  uuid references clinical_notes(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index clinical_notes_patient_idx on clinical_notes(patient_id, created_at desc);
create index clinical_notes_author_idx  on clinical_notes(author_user_id);

-- Defence-in-depth: a DB-level CHECK that author must be doctor.
-- Enforced by a trigger since we can't reference app_users.role_id in a CHECK.
create or replace function enforce_clinical_note_author_is_doctor()
returns trigger language plpgsql as $$
declare
  v_role role_name;
begin
  select r.name into v_role
    from app_users u join roles r on r.id = u.role_id
    where u.id = new.author_user_id;
  if v_role is distinct from 'doctor' then
    raise exception 'clinical_notes: author must have role=doctor (got %)', coalesce(v_role::text, 'null')
      using errcode = '42501';
  end if;
  return new;
end $$;

create trigger clinical_notes_enforce_doctor
before insert or update on clinical_notes
for each row execute function enforce_clinical_note_author_is_doctor();

-- ═══════════════════════════════════════════════════════════════════════════
-- AUDIT LOG (§10.5) — append-only, hash-chained
-- ═══════════════════════════════════════════════════════════════════════════

create table audit_logs (
  id               uuid primary key default gen_random_uuid(),
  actor_user_id    uuid references app_users(id),
  actor_role       role_name,
  action           audit_action not null,
  entity_type      text,
  entity_id        uuid,
  patient_id       uuid,
  metadata_json    jsonb not null default '{}'::jsonb,
  ip_address       inet,
  user_agent       text,
  created_at       timestamptz not null default now(),
  prev_hash        text,
  entry_hash       text not null,
  -- Reserved for v2 Inntris on-chain anchor (§FR-11, rule 8).
  chain_anchor_id  text
);

create index audit_logs_created_at_idx on audit_logs(created_at desc);
create index audit_logs_actor_idx      on audit_logs(actor_user_id, created_at desc);
create index audit_logs_patient_idx    on audit_logs(patient_id, created_at desc);
create index audit_logs_action_idx     on audit_logs(action, created_at desc);

-- Block UPDATE and DELETE at the table level for ALL roles (including owner).
-- Append-only is enforced by revoking privileges in 0002_rls_policies.sql.

-- ═══════════════════════════════════════════════════════════════════════════
-- USER INVITES & BREAK-GLASS (§FR-12, §10.4)
-- ═══════════════════════════════════════════════════════════════════════════

create table user_invites (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  role_id      uuid not null references roles(id),
  invited_by   uuid not null references app_users(id),
  token_hash   text not null unique,      -- sha256 of single-use token
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  created_at   timestamptz not null default now()
);

create table break_glass_requests (
  id                  uuid primary key default gen_random_uuid(),
  requester_user_id   uuid not null references app_users(id),
  target_patient_id   uuid not null references patients(id),
  justification       text not null,
  requested_at        timestamptz not null default now(),
  cool_off_until      timestamptz not null,     -- 48h after requested_at
  approved_at         timestamptz,
  accessed_at         timestamptz,
  revoked_at          timestamptz,
  access_window_ends  timestamptz                -- 24h from first access
);

create index break_glass_patient_idx on break_glass_requests(target_patient_id, requested_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- PRACTICE SETTINGS (§FR-13) — single-row
-- ═══════════════════════════════════════════════════════════════════════════

create table practice_settings (
  id                      int primary key default 1,
  practice_name           text not null default 'Dr. Thomas Mtshali Inc.',
  practice_tagline        text not null default 'Specialist Laparoscopic and General Surgeon',
  practice_number         text not null default '1144286',
  doctor_name             text not null default 'Dr. Thomas Mtshali',
  doctor_qualifications   text not null default 'MBBCh, BSc (Lab Med) (WITS), FCS (SA), MMed (Sx2)',
  practice_address        text not null default 'Clinix Naledi-Nkanyezi Private Hospital, 1 Moshoeshoe Street, Sebokeng 1982',
  practice_phone          text not null default '016 420-3160',
  logo_path               text,
  file_number_prefix      text not null default 'DTM',
  file_number_format      text not null default '{PREFIX}-{YYYY}-{SEQ:06}',
  active_consent_version  text not null default '1.0.0',
  active_consent_body     text not null default '',
  information_officer_name  text not null default 'Dr. Thomas Mtshali',
  information_officer_email text,
  privacy_notice_body     text not null default '',
  updated_at              timestamptz not null default now(),
  updated_by              uuid references app_users(id),
  constraint single_row check (id = 1)
);

insert into practice_settings (id) values (1) on conflict do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- TRIGGERS — updated_at maintenance
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$ declare t text; begin
  for t in
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'updated_at'
  loop
    execute format(
      'create trigger trg_set_updated_at before update on %I
         for each row execute function set_updated_at()', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- FILE NUMBER ALLOCATOR (§FR-4) — atomic, concurrency-safe
-- ═══════════════════════════════════════════════════════════════════════════

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

  -- Lock or insert this year's sequence row.
  insert into file_number_sequences (year, next_value) values (v_year, 1)
    on conflict (year) do nothing;

  update file_number_sequences
    set next_value = next_value + 1
    where year = v_year
    returning next_value - 1 into v_seq;

  -- Read format from settings
  select coalesce(p_prefix, file_number_prefix), file_number_format
    into v_prefix, v_format
    from practice_settings where id = 1;

  v_result := replace(v_format, '{PREFIX}', v_prefix);
  v_result := replace(v_result, '{YYYY}', v_year::text);
  v_result := replace(v_result, '{SEQ:06}', lpad(v_seq::text, 6, '0'));

  return v_result;
end $$;

revoke all on function allocate_file_number(int, text) from public;
