-- Synthetic role, mutation and replay tests for security findings 1–3.
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

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

insert into public.patient_documents(id,patient_id,category,storage_key,original_storage_key,original_filename,mime_type,file_size,sha256_hash,uploaded_by)
values ('f0000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','other','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/existing.pdf','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/original.pdf','existing.pdf','application/pdf',10,repeat('a',64),'22222222-2222-2222-2222-222222222222');
insert into public.billing_export_items(patient_id,hospital,export_month,patient_name,status)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Nkanyezi Private Hospital','2026-10-01','Synthetic','pending'),
       ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Nkanyezi Private Hospital','2026-09-01','Synthetic','exported');

select ok(not has_any_column_privilege('authenticated','public.patients','UPDATE'),'no direct patient column UPDATE survives');
select ok(not has_any_column_privilege('authenticated','public.patient_documents','UPDATE'),'no direct document column UPDATE survives');
select ok(not has_table_privilege('authenticated','public.patients','INSERT'),'no direct patient INSERT');
select ok(not has_table_privilege('authenticated','public.patient_documents','INSERT'),'no direct document INSERT');
select ok(not has_table_privilege('authenticated','public.document_upload_intents','SELECT'),'upload intents are not browser-readable');
select ok(not has_function_privilege('authenticated','public.finalize_document_upload(uuid,uuid,uuid,bigint,text,text,inet,text)','EXECUTE'),'browser cannot attest a file hash');
select ok(not has_function_privilege('anon','public.finalize_document_upload(uuid,uuid,uuid,bigint,text,text,inet,text)','EXECUTE'),'anonymous finalisation denied');
select ok(not has_function_privilege('authenticated','public.mutate_patient_document(uuid,uuid,uuid,text,text,text,text,inet,text)','EXECUTE'),'document operation is server-only');
select ok(not has_function_privilege('authenticated','public.enqueue_record_mutation_audit(uuid,public.role_name,public.audit_action,text,uuid,uuid,jsonb,inet,text)','EXECUTE'),'browser cannot forge mutation audit events');

select pg_temp.impersonate('22222222-2222-2222-2222-222222222222');
select throws_ok($$update public.patients set status='archived' where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,'42501',null,'staff cannot archive via direct SQL/Data API');
select throws_ok($$update public.patients set hospital='Fountain Private Hospital',file_number='FOU-forged' where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,'42501',null,'staff cannot bypass reassignment');
select throws_ok($$update public.patient_documents set storage_key='substituted',sha256_hash='forged',archived_by='11111111-1111-1111-1111-111111111111'$$,'42501',null,'staff cannot overwrite protected document metadata');
select throws_ok($$insert into public.patient_documents(id,patient_id) values ('f0000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') on conflict(id) do update set storage_key='forged'$$,'42501',null,'UPSERT cannot bypass document controls');
select throws_ok($$select public.set_patient_archive_state('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true,'11111111-1111-1111-1111-111111111111')$$,'42501',null,'staff cannot spoof a doctor at the service-only archive RPC');
select throws_ok($$select * from public.update_patient_bundle('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','{"status":"archived"}')$$,'22023',null,'bundle rejects protected state fields');
select throws_ok($$select * from public.update_patient_bundle('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','{"hospital":"Fountain Private Hospital"}')$$,'PT409',null,'bundle still refuses hospital reassignment');
select lives_ok($$select * from public.update_patient_bundle('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','{"surname":"Edited"}')$$,'ordinary staff demographics editing still works without direct UPDATE');
select is((select surname from public.patients where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),'Edited','demographics actually persisted');
select matches((select new_file_number from public.reassign_patient_hospital('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Fountain Private Hospital','Correct the hospital selected at onboarding')),'^FOU-','staff reassignment still works');
reset role;
select is((select count(*)::int from public.patient_file_number_history where patient_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),1,'reassignment records history');
select is((select count(*)::int from public.billing_export_items where patient_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and status='pending'),0,'reassignment removes stale pending billing entries');
select is((select count(*)::int from public.billing_export_items where patient_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and status='exported'),1,'exported billing history survives');
select is((select count(*)::int from public.audit_log_outbox where payload_json->>'action' in ('patient_update','patient_file_reassigned')),2,'direct controlled RPC calls persist durable audit events');

-- Prove audit failure rolls back the mutation instead of losing its event.
create function pg_temp.reject_new_audit() returns trigger language plpgsql as $$begin raise exception 'synthetic audit outage'; end;$$;
create trigger synthetic_audit_failure before insert on public.audit_log_outbox for each row execute function pg_temp.reject_new_audit();
select pg_temp.impersonate('22222222-2222-2222-2222-222222222222');
select throws_ok($$select * from public.update_patient_bundle('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','{"surname":"Lost audit"}')$$,'P0001',null,'audit outage rejects the entire mutation');
select is((select surname from public.patients where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),'Edited','failed audited mutation rolled back');
reset role;
drop trigger synthetic_audit_failure on public.audit_log_outbox;

select pg_temp.impersonate('33333333-3333-3333-3333-333333333333');
select throws_ok($$select * from public.update_patient_bundle('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','{"surname":"Admin"}')$$,'PT404',null,'definer bundle still hides patients from admin');
reset role;

-- Server-only upload attestations, replay and actor/patient binding.
insert into public.document_upload_intents(id,patient_id,actor_user_id,storage_key,original_filename,category,mime_type,declared_size)
values ('f1000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/new.pdf','new.pdf','other','application/pdf',10),
       ('f1000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/original.pdf','original.pdf','other','application/pdf',10),
       ('f1000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/expired.pdf','expired.pdf','other','application/pdf',10);
update public.document_upload_intents set expires_at=now()-interval '1 minute' where id='f1000000-0000-0000-0000-000000000003';
set local role service_role;
select throws_ok($$select * from public.finalize_document_upload('f1000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',10,repeat('a',64),'application/pdf')$$,'PT404',null,'intent cannot be finalised by a different actor');
select throws_ok($$select * from public.finalize_document_upload('f1000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',10,repeat('a',64),'application/pdf')$$,'PT404',null,'intent cannot cross patients');
select throws_ok($$select * from public.finalize_document_upload('f1000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',10,repeat('a',64),'image/png')$$,'22023',null,'intent rejects mismatched content attestation');
select throws_ok($$select * from public.finalize_document_upload('f1000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',10,repeat('a',64),'application/pdf')$$,'PT409',null,'retained original object cannot be registered again');
select throws_ok($$select * from public.finalize_document_upload('f1000000-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',10,repeat('a',64),'application/pdf')$$,'PT410',null,'expired pending upload is rejected');
select lives_ok($$select * from public.finalize_document_upload('f1000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',10,repeat('a',64),'application/pdf')$$,'valid server-checked staff upload succeeds');
select lives_ok($$select * from public.finalize_document_upload('f1000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',10,repeat('a',64),'application/pdf')$$,'finalisation retry succeeds without duplicate registration');
select is((select count(*)::int from public.patient_documents where storage_key='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/new.pdf'),1,'one document per consumed upload intent');
select is((select count(*)::int from public.audit_log_outbox where payload_json->>'action'='document_upload'),1,'finalisation replay does not duplicate audit events');

select lives_ok($$select * from public.mutate_patient_document('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','f0000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','rename','renamed.pdf','existing.pdf')$$,'authorised staff rename remains functional');
select throws_ok($$select * from public.mutate_patient_document('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','f0000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','rename','stale.pdf','existing.pdf')$$,'PT409',null,'stale rename fails without overwriting a concurrent edit');
select lives_ok($$select * from public.mutate_patient_document('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','f0000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','archive')$$,'authorised staff soft archive remains functional');
select is((select storage_key from public.patient_documents where id='f0000000-0000-0000-0000-000000000001'),'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/existing.pdf','document archive preserves Storage reference');
select throws_ok($$select public.set_patient_archive_state('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true,'22222222-2222-2222-2222-222222222222')$$,'42501',null,'DB rechecks that staff cannot archive patients');
select lives_ok($$select public.set_patient_archive_state('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true,'11111111-1111-1111-1111-111111111111')$$,'doctor archive works');
select lives_ok($$select public.set_patient_archive_state('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false,'33333333-3333-3333-3333-333333333333')$$,'admin unarchive works without demographics permission');
select is((select count(*)::int from public.audit_log_outbox where payload_json->>'action' in ('document_rename','document_archive','patient_archive','patient_unarchive')),4,'document and archive changes each have a durable event');
select lives_ok($$select * from public.documents_pending_backup(10)$$,'backup job retains access');
select lives_ok($$select * from public.lease_patient_document_for_compression('f0000000-0000-0000-0000-000000000001')$$,'compression job retains access');
reset role;
update public.app_users set status='deactivated' where id='22222222-2222-2222-2222-222222222222';
set local role service_role;
select throws_ok($$select * from public.finalize_document_upload('f1000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',10,repeat('a',64),'application/pdf')$$,'42501',null,'deactivation prevents replay through the server-only operation');
reset role;
-- The new intent FK must not break operator-only synthetic data cleanup.
insert into public.patients(id,file_number,hospital,title,first_names,surname,id_type,id_number,id_country,phone,address)
values ('f2000000-0000-0000-0000-000000000001','FOU-2026-900003','Fountain Private Hospital','Mr','Disposable','Test','passport','TEST-CLEANUP','ZA','000','Test only');
insert into public.document_upload_intents(patient_id,actor_user_id,storage_key,original_filename,category,mime_type,declared_size)
values ('f2000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','f2000000-0000-0000-0000-000000000001/test.pdf','test.pdf','other','application/pdf',10);
set local role service_role;
select lives_ok($$select public.hard_delete_patient_data('f2000000-0000-0000-0000-000000000001')$$,'operator cleanup still handles an abandoned test upload');
reset role;
select is((select count(*)::int from public.document_upload_intents where patient_id='f2000000-0000-0000-0000-000000000001'),0,'test upload intent removed by controlled cleanup');
select * from finish();
rollback;
