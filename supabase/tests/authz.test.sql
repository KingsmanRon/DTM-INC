-- pgTAP suite for the security invariants the product stands on (review #14).
--
-- Run locally / in CI:
--   supabase db start      (applies ./supabase/migrations to a local stack)
--   supabase test db       (executes ./supabase/tests/*.sql with pgTAP)
--
-- Everything runs inside ONE transaction and rolls back — no state survives.
-- Fixtures are inserted as the superuser (table owner bypasses RLS); each
-- assertion then impersonates an app user by setting the JWT-claims GUCs and
-- switching to the `authenticated` role, exactly how PostgREST executes
-- requests. Both claim GUC spellings are set for image compatibility.
--
-- WHY THIS EXISTS: migrations 0019/0026/0032 are all "reassert" fixes for
-- grants/definitions that drifted. With a second practice deployment (v2),
-- drift becomes a cross-client incident — these tests turn the authz matrix
-- from prose into CI.

begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

-- ── Fixtures (as superuser; RLS bypassed by table ownership) ────────────────

insert into auth.users (instance_id, id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'doctor@test.local'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'staff@test.local'),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'admin@test.local');

insert into public.app_users (id, email, full_name, role_id, status)
values
  ('11111111-1111-1111-1111-111111111111', 'doctor@test.local', 'Test Doctor', (select id from public.roles where name = 'doctor'), 'active'),
  ('22222222-2222-2222-2222-222222222222', 'staff@test.local',  'Test Staff',  (select id from public.roles where name = 'staff'),  'active'),
  ('33333333-3333-3333-3333-333333333333', 'admin@test.local',  'Test Admin',  (select id from public.roles where name = 'admin'),  'active');

insert into public.patients (id, file_number, hospital, title, first_names, surname, id_number, id_type, phone, address)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'NKA-2026-900001', 'Nkanyezi Private Hospital', 'Mr', 'Test', 'Patient', '8001015009087', 'sa_id', '+27110000000', '1 Test Street'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'NKA-2026-900002', 'Nkanyezi Private Hospital', 'Mr', 'Archived', 'Patient', '8001015009088', 'sa_id', '+27110000001', '2 Test Street');

update public.patients
   set status = 'archived', archived_at = now()
 where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

insert into public.patient_encryption_keys (id, patient_id, wrapped_dek, kek_id)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '\xdeadbeefdeadbeefdeadbeef', 'test-kek');

insert into public.clinical_notes (id, patient_id, author_user_id, note_date, encrypted_body, nonce, dek_id, is_finalised, finalised_at)
values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', current_date, '\xdeadbeef', '\x000000000000000000000000', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true, now());

insert into public.consent_records (id, patient_id, consent_text_version, consent_text_hash, accepted_by_user_id, signature_type, signature_value, patient_present_attestation)
values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '1.0.0', repeat('a', 64), '22222222-2222-2222-2222-222222222222', 'typed_name', 'Test Patient', true);

-- Impersonation helper: PostgREST sets these GUCs per request.
create or replace function pg_temp.impersonate(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- ── 1-3: clinical notes are invisible and unwritable to staff ────────────────

select pg_temp.impersonate('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.clinical_notes),
  0,
  'staff sees ZERO clinical notes (RLS layer 3)'
);

select is(
  (select count(*)::int from public.patient_encryption_keys),
  0,
  'staff sees ZERO patient encryption keys'
);

select throws_ok(
  $$ insert into public.clinical_notes (patient_id, author_user_id, encrypted_body, nonce, dek_id)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', '\xdeadbeef', '\x000000000000000000000000', 'cccccccc-cccc-cccc-cccc-cccccccccccc') $$,
  '42501',
  null,
  'staff cannot insert a clinical note (RLS refuses)'
);

reset role;

-- ── 4: even a doctor cannot create a note AUTHORED by a non-doctor ──────────

select pg_temp.impersonate('11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ insert into public.clinical_notes (patient_id, author_user_id, encrypted_body, nonce, dek_id)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', '\xdeadbeef', '\x000000000000000000000000', 'cccccccc-cccc-cccc-cccc-cccccccccccc') $$,
  '42501',
  null,
  'author-must-be-doctor trigger blocks a staff-authored note'
);

-- ── 5-6: finalised notes are immutable (0027/0034) ───────────────────────────

select throws_ok(
  $$ update public.clinical_notes
        set encrypted_body = '\xfeedface'
      where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  'PT409',
  null,
  'finalised note content cannot be modified'
);

select throws_ok(
  $$ delete from public.clinical_notes
      where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  'PT409',
  null,
  'finalised note cannot be deleted'
);

reset role;

-- ── 7-8: consent records are immutable (0043) ───────────────────────────────

select pg_temp.impersonate('22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ update public.consent_records set signature_value = 'Forged'
      where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' $$,
  '42501',
  null,
  'staff has no UPDATE privilege on consent_records'
);

reset role;

select throws_ok(
  $$ update public.consent_records set signature_value = 'Forged'
      where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' $$,
  'PT409',
  null,
  'even a privileged role hits the consent immutability trigger'
);

-- ── 9: admin cannot read demographics (authz matrix §9) ──────────────────────

select pg_temp.impersonate('33333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.patients),
  0,
  'admin sees ZERO patient demographics'
);

-- ── 10: onboard_patient refuses non-doctor/staff callers (0045) ──────────────

select throws_ok(
  $$ select * from public.onboard_patient(
       '33333333-3333-3333-3333-333333333333',
       '{"hospital":"Nkanyezi Private Hospital","title":"Mr","first_names":"X","surname":"Y","id_type":"sa_id","id_number":"8001015009087","phone":"+27110000002","address":"3 Street"}'::jsonb,
       '{"title":"Mr","first_names":"X","surname":"Y","id_number":"8001015009087","date_of_birth":"1980-01-01","marital_status":"single","phone":"+27110000002","home_address":"3 Street"}'::jsonb,
       '{"is_private_payer":true}'::jsonb,
       '{"name":"N","relationship":"R","phone":"+27110000003"}'::jsonb,
       '{"referrer_type":"self"}'::jsonb,
       '[]'::jsonb,
       '{"consent_text_version":"1.0.0","consent_text_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","signature_type":"typed_name","signature_value":"X Y","patient_present_attestation":"true"}'::jsonb
     ) $$,
  '42501',
  null,
  'onboard_patient rejects an admin caller'
);

reset role;

-- ── 11-12: onboarding as staff works and respects the hospitals table ────────

select pg_temp.impersonate('22222222-2222-2222-2222-222222222222');

select matches(
  (select file_number from public.onboard_patient(
     '22222222-2222-2222-2222-222222222222',
     '{"hospital":"Fountain Private Hospital","title":"Mr","first_names":"New","surname":"Patient","id_type":"sa_id","id_number":"9001015009086","phone":"+27110000004","address":"4 Street"}'::jsonb,
     '{"title":"Mr","first_names":"New","surname":"Patient","id_number":"9001015009086","date_of_birth":"1990-01-01","marital_status":"single","phone":"+27110000004","home_address":"4 Street"}'::jsonb,
     '{"is_private_payer":true}'::jsonb,
     '{"name":"N","relationship":"R","phone":"+27110000005"}'::jsonb,
     '{"referrer_type":"self"}'::jsonb,
     '[]'::jsonb,
     '{"consent_text_version":"1.0.0","consent_text_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","signature_type":"typed_name","signature_value":"New Patient","patient_present_attestation":"true"}'::jsonb
   )),
  '^FOU-',
  'staff onboarding allocates the hospital''s file prefix from public.hospitals'
);

select throws_like(
  $$ select * from public.onboard_patient(
       '22222222-2222-2222-2222-222222222222',
       '{"hospital":"Nonexistent Hospital","title":"Mr","first_names":"X","surname":"Y","id_type":"sa_id","id_number":"8001015009087","phone":"+27110000006","address":"5 Street"}'::jsonb,
       '{"title":"Mr","first_names":"X","surname":"Y","id_number":"8001015009087","date_of_birth":"1980-01-01","marital_status":"single","phone":"+27110000006","home_address":"5 Street"}'::jsonb,
       '{"is_private_payer":true}'::jsonb,
       '{"name":"N","relationship":"R","phone":"+27110000007"}'::jsonb,
       '{"referrer_type":"self"}'::jsonb,
       '[]'::jsonb,
       '{"consent_text_version":"1.0.0","consent_text_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","signature_type":"typed_name","signature_value":"X Y","patient_present_attestation":"true"}'::jsonb
     ) $$,
  '%Invalid or inactive hospital%',
  'unknown hospital hard-fails — no silent default prefix'
);

-- ── 13: active_patients view excludes archived rows ──────────────────────────

select is(
  (select count(*)::int from public.active_patients where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0,
  'archived patients are invisible through active_patients'
);

-- ── 14: update_patient_bundle hides patients from admin (PT404, no leak) ─────

reset role;
select pg_temp.impersonate('33333333-3333-3333-3333-333333333333');

select throws_ok(
  $$ select * from public.update_patient_bundle(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       '{"surname":"Hacked"}'::jsonb, null, null, null, null) $$,
  'PT404',
  null,
  'update_patient_bundle returns not-found to admin (RLS, security invoker)'
);

-- ── 15-19: hospital/file-number reassignment (0053) ──────────────────────────

select throws_ok(
  $$ select * from public.reassign_patient_hospital(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Fountain Private Hospital',
       'admin should never be able to do this') $$,
  '42501',
  null,
  'reassign_patient_hospital rejects an admin caller'
);

reset role;
select pg_temp.impersonate('22222222-2222-2222-2222-222222222222');

select matches(
  (select new_file_number from public.reassign_patient_hospital(
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Fountain Private Hospital',
     'Onboarded under Nkanyezi in error; patient admits at Fountain')),
  '^FOU-',
  'reassignment issues a new file number under the correct prefix'
);

select throws_ok(
  $$ select * from public.reassign_patient_hospital(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Fountain Private Hospital',
       'already there - this must be refused') $$,
  'PT409',
  null,
  'reassigning to the SAME hospital is refused'
);

reset role;

select is(
  (select count(*)::int from public.patient_file_number_history
    where patient_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and old_file_number = 'NKA-2026-900001'
      and new_hospital = 'Fountain Private Hospital'),
  1,
  'the retired number is recorded in patient_file_number_history'
);

select is(
  (select count(*)::int from public.file_number_reservations
    where prefix = 'NKA' and year = 2026 and seq = 900001
      and consumed_at is not null),
  1,
  'the retired number is poison-pilled in file_number_reservations (never reissued)'
);

select * from finish();
rollback;
