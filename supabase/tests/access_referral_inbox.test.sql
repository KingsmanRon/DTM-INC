-- pgTAP suite for the ACCESS referral inbox (0063).
--
-- Proves: who can see and change inbox rows, that deliveries are idempotent
-- by ACCESS execution id, that a patient match is only ever a suggestion, and
-- that reception's accept/decline rules hold. One transaction, rolled back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(37);

-- ── Fixtures (as superuser) ─────────────────────────────────────────────────

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
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'NKA-2026-910001', 'Nkanyezi Private Hospital', 'Mr', 'Synthetic', 'Patient', '8001015009087', 'sa_id', '+27110000000', '1 Test Street'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'NKA-2026-910002', 'Nkanyezi Private Hospital', 'Mr', 'Archived', 'Patient', '8001015009088', 'sa_id', '+27110000001', '2 Test Street');

update public.patients
   set status = 'archived', archived_at = now()
 where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

create or replace function pg_temp.impersonate(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.delivery(p_identifier text) returns jsonb language sql as $$
  select jsonb_build_object(
    'case_reference', 'REF-1A2B3C4D',
    'referral_id', '9d9d9d9d-9d9d-4d9d-9d9d-9d9d9d9d9d9d',
    'received_at', '2026-10-17T08:00:00Z',
    'patient', jsonb_build_object('given_name', 'Synthetic', 'family_name', 'Patient',
                                  'date_of_birth', '1980-01-01', 'identifier', p_identifier),
    'referrer', jsonb_build_object('name', 'Dr Fixture'),
    'reason', 'Synthetic referral for review',
    'requested_service', 'GENERAL_SURGERY',
    'referral_date', '2026-10-15',
    'funding', jsonb_build_object('type', 'MEDICAL_AID', 'scheme', 'Synthetic Med'),
    'documents_held', jsonb_build_array('referral_letter'));
$$;

-- ── 1-14: nobody writes the inbox directly; only the right roles call RPCs ──

select ok((select relrowsecurity from pg_class where oid = 'public.access_referral_inbox'::regclass), 'inbox has RLS enabled');
select ok(not has_table_privilege('anon', 'public.access_referral_inbox', 'SELECT'), 'anon cannot read the inbox');
select ok(not has_table_privilege('authenticated', 'public.access_referral_inbox', 'INSERT'), 'signed-in users cannot insert inbox rows');
select ok(not has_table_privilege('authenticated', 'public.access_referral_inbox', 'UPDATE'), 'signed-in users cannot update inbox rows directly');
select ok(not has_table_privilege('authenticated', 'public.access_referral_inbox', 'DELETE'), 'signed-in users cannot delete inbox rows');
select ok(not has_table_privilege('service_role', 'public.access_referral_inbox', 'SELECT'), 'the service role cannot read the inbox table directly');
select ok(not has_function_privilege('anon', 'public.receive_access_referral(uuid,uuid,uuid,public.access_data_mode,text,jsonb)', 'EXECUTE'), 'anon cannot deliver referrals');
select ok(not has_function_privilege('authenticated', 'public.receive_access_referral(uuid,uuid,uuid,public.access_data_mode,text,jsonb)', 'EXECUTE'), 'signed-in users cannot deliver referrals');
select ok(has_function_privilege('service_role', 'public.receive_access_referral(uuid,uuid,uuid,public.access_data_mode,text,jsonb)', 'EXECUTE'), 'the integration API can deliver referrals');
select ok(not has_function_privilege('authenticated', 'public.read_access_referral(uuid,text)', 'EXECUTE'), 'signed-in users cannot call the integration read-back');
select ok(has_function_privilege('authenticated', 'public.accept_access_referral(uuid,uuid,public.referrer_type)', 'EXECUTE'), 'signed-in users can call accept (role checked inside)');
select ok(not has_function_privilege('anon', 'public.accept_access_referral(uuid,uuid,public.referrer_type)', 'EXECUTE'), 'anon cannot accept referrals');
select ok(not has_function_privilege('anon', 'public.decline_access_referral(uuid,text)', 'EXECUTE'), 'anon cannot decline referrals');
select ok(not has_sequence_privilege('anon', 'public.access_referral_inbox_number_seq', 'USAGE'), 'anon cannot use the inbox number sequence');

-- ── 15-22: delivery is idempotent by execution id; matching only suggests ───

set local role service_role;

select is(
  (select row(deduplicated, conflict, status)::text from public.receive_access_referral(
     'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1',
     '11111111-1111-4111-8111-111111111111', 'synthetic', repeat('a', 64), pg_temp.delivery('8001015009087'))),
  '(f,f,pending)', 'a first delivery is stored as pending');

reset role;
select matches(
  (select reference from public.access_referral_inbox where access_execution_id = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1'),
  '^IN-[0-9]{6}$', 'each delivery gets a human inbox reference');

set local role service_role;
select is(
  (select row(deduplicated, conflict)::text from public.receive_access_referral(
     'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1',
     '11111111-1111-4111-8111-111111111111', 'synthetic', repeat('a', 64), pg_temp.delivery('8001015009087'))),
  '(t,f)', 'the same delivery again is a replay, not a second row');

select is(
  (select row(deduplicated, conflict)::text from public.receive_access_referral(
     'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1',
     '11111111-1111-4111-8111-111111111111', 'synthetic', repeat('b', 64), pg_temp.delivery('8001015009087'))),
  '(t,t)', 'a different payload under the same execution id is reported as a conflict');

select is(
  (select count(*)::int from public.receive_access_referral(
     'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2', 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2',
     '11111111-1111-4111-8111-111111111111', 'synthetic', repeat('c', 64), pg_temp.delivery('8001015009088'))),
  1, 'a second referral is stored');

select is(
  (select reference from public.read_access_referral('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', null)),
  (select reference from public.read_access_referral(null, (select reference from public.read_access_referral('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', null)))),
  'read-back finds a delivery by execution id and by inbox reference');

select is(
  (select count(*)::int from public.read_access_referral('00000000-0000-4000-8000-000000000000', null)),
  0, 'read-back of an unknown execution id finds nothing');

reset role;
select is(
  (select array[
     (select suggested_patient_id::text from public.access_referral_inbox where access_execution_id = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1'),
     coalesce((select suggested_patient_id::text from public.access_referral_inbox where access_execution_id = 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2'), 'none')]),
  array['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'none'],
  'an exact match to an active file is suggested; an archived file is not');

-- ── 23-25: doctor and staff see the inbox; admin does not ───────────────────

select pg_temp.impersonate('22222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.access_referral_inbox), 2, 'staff see the inbox');
reset role;
select pg_temp.impersonate('11111111-1111-1111-1111-111111111111');
select is((select count(*)::int from public.access_referral_inbox), 2, 'the doctor sees the inbox');
reset role;
select pg_temp.impersonate('33333333-3333-3333-3333-333333333333');
select is((select count(*)::int from public.access_referral_inbox), 0, 'admin sees no inbox rows (no demographic read)');

-- ── 26-37: accept and decline ───────────────────────────────────────────────

reset role;
-- Inbox ids captured as the owner and passed in GUCs, so each check below
-- fails or succeeds on the role rule under test, not on reading the id.
do $$ begin
  perform set_config('test.inbox_1', (select id::text from public.access_referral_inbox
    where access_execution_id = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1'), true);
  perform set_config('test.inbox_2', (select id::text from public.access_referral_inbox
    where access_execution_id = 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2'), true);
end $$;

select pg_temp.impersonate('33333333-3333-3333-3333-333333333333');
select throws_ok(
  $$ select * from public.accept_access_referral(current_setting('test.inbox_1')::uuid,
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'gp') $$,
  '42501', null, 'admin cannot accept referrals');
reset role;

select pg_temp.impersonate('22222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ select * from public.accept_access_referral('00000000-0000-4000-8000-000000000000',
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'gp') $$,
  'PT404', null, 'an unknown inbox id is not found');

select throws_ok(
  $$ select * from public.accept_access_referral(current_setting('test.inbox_1')::uuid,
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'self') $$,
  '22023', null, 'a referral from ACCESS is never a self-referral');

select throws_ok(
  $$ select * from public.accept_access_referral(current_setting('test.inbox_1')::uuid,
       'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'gp') $$,
  'PT409', null, 'a referral cannot be filed on an archived patient');

select lives_ok(
  $$ select * from public.accept_access_referral(current_setting('test.inbox_1')::uuid,
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'gp') $$,
  'staff can accept a pending referral onto an active file');
reset role;

select is(
  (select row(i.status, r.referrer_name, r.referral_notes like 'Received via ACCESS: REF-1A2B3C4D (inbox IN-%')::text
     from public.access_referral_inbox i
     join public.patient_referrals r on r.id = i.linked_referral_id
    where i.access_execution_id = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1'),
  '(accepted,"Dr Fixture",t)',
  'accepting records the referral on the patient file and closes the inbox item');

select pg_temp.impersonate('22222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ select * from public.accept_access_referral(current_setting('test.inbox_1')::uuid,
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'gp') $$,
  'PT409', null, 'an accepted referral cannot be accepted twice');

select throws_ok(
  $$ select * from public.decline_access_referral(current_setting('test.inbox_2')::uuid, 'no') $$,
  '22023', null, 'declining needs a reason');

select lives_ok(
  $$ select * from public.decline_access_referral(current_setting('test.inbox_2')::uuid,
       'Not this practice''s speciality') $$,
  'staff can decline a pending referral with a reason');

select throws_ok(
  $$ select * from public.accept_access_referral(current_setting('test.inbox_2')::uuid,
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'gp') $$,
  'PT409', null, 'a declined referral cannot be accepted');

select throws_ok(
  $$ update public.access_referral_inbox set status = 'pending' $$,
  '42501', null, 'staff cannot rewrite inbox rows directly');
reset role;

select throws_ok(
  $$ insert into public.access_referral_inbox (
       access_execution_id, access_correlation_id, access_tenant_id, access_case_reference,
       access_referral_id, data_mode, payload_sha256, patient_given_name, patient_family_name,
       patient_date_of_birth, referrer_name, received_at, status)
     values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'REF-00000000',
       gen_random_uuid(), 'synthetic', repeat('d', 64), 'A', 'B', '1990-01-01', 'C', now(), 'accepted') $$,
  '23514', null, 'an accepted row must name its patient and referral');

select * from finish();
rollback;
