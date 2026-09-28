begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(not has_function_privilege('anon', p.oid, 'EXECUTE'), 'anon cannot execute ' || p.oid::regprocedure)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','private') and p.prosecdef;

select ok(not has_function_privilege('authenticated', p.oid, 'EXECUTE'), 'authenticated cannot execute internal ' || p.oid::regprocedure)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','private') and p.proname in (
  'allocate_file_number','create_app_secret','read_app_secret','update_app_secret',
  'hard_delete_patient_data','try_acquire_maintenance_lock','release_maintenance_lock',
  'write_audit_entry','write_audit_entry_atomic','lease_patient_document_for_compression',
  'swap_patient_document_to_compressed','rollback_patient_document_compression',
  'patient_document_compression_status_counts');

select ok(array_to_string(p.proconfig, ',') like '%search_path=%', 'fixed path: ' || p.oid::regprocedure)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','private') and not exists (
  select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e');

insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','doctor@security.test'),
 ('10000000-0000-0000-0000-000000000002','staff@security.test'),
 ('10000000-0000-0000-0000-000000000003','admin@security.test');
insert into public.app_users(id,email,full_name,role_id,status)
select a.id,a.email,'Test ' || r.name,r.id,'active' from auth.users a
join public.roles r on a.email = r.name || '@security.test';
insert into public.patients(id,file_number,hospital,title,first_names,surname,id_type,id_number,phone,address)
values('20000000-0000-0000-0000-000000000001','SEC-2026-000001','Nkanyezi Private Hospital','Mr',
 'Test','Security','sa_id','8001015009087','000','Test only');

create function pg_temp.impersonate(uid uuid, aal text default 'aal2') returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claims',json_build_object('sub',uid,'role','authenticated','aal',aal)::text,true);
 perform set_config('request.jwt.claim.sub',uid::text,true);
end;
$$;

-- Execute denials as real database roles; grants alone do not prove the body.
set local role anon;
select throws_ok($$select public.read_app_secret('anything')$$,'42501',null,'anon cannot read secrets');
select throws_ok($$select public.current_app_role()$$,'42501',null,'anon cannot resolve roles');
select throws_ok($$select * from public.get_my_app_profile()$$,'42501',null,'anon cannot read profiles');
select throws_ok($$select * from public.onboard_patient(null,'{}','{}','{}','{}','{}','[]','{}')$$,'42501',null,'anon cannot onboard');
reset role;

-- The three application roles use the same authenticated database role.
select pg_temp.impersonate('10000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$select public.read_app_secret('anything')$$,'42501',null,'doctor cannot read KEKs');
select throws_ok($$select private.hard_delete_patient_data(null)$$,'42501',null,'doctor cannot hard delete');
select throws_ok($$select public.allocate_file_number()$$,'42501',null,'doctor cannot allocate outside onboarding');
select throws_ok($$select public.stage_billing_export_items('10000000-0000-0000-0000-000000000002','Nkanyezi Private Hospital','2026-01-01','{}')$$,'42501',null,'doctor cannot spoof billing actor');
select is((select count(*)::int from public.patients),1,'AAL2 doctor reads practice patients');
select throws_ok($$update public.app_users set role_id=role_id where id=auth.uid()$$,'42501',null,'doctor cannot directly change profiles');
reset role;

select pg_temp.impersonate('10000000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok($$select public.try_acquire_maintenance_lock('outbox_drain',60)$$,'42501',null,'staff cannot acquire maintenance lock');
select throws_ok($$select public.release_maintenance_lock('outbox_drain')$$,'42501',null,'staff cannot release maintenance lock');
select throws_ok($$select private.create_app_secret('x','x','x')$$,'42501',null,'staff cannot create secrets');
select throws_ok($$select private.update_app_secret('x','x','x')$$,'42501',null,'staff cannot rotate secrets');
select throws_ok($$select public.stage_billing_export_items('10000000-0000-0000-0000-000000000001','Nkanyezi Private Hospital','2026-01-01','{}')$$,'42501',null,'staff cannot spoof billing actor');
select is((select count(*)::int from public.patients),1,'AAL2 staff reads practice patients');
select throws_ok($$update public.app_users set role_id=role_id where id=auth.uid()$$,'42501',null,'staff cannot directly change profiles');
select is((select count(*)::int from public.clinical_notes),0,'staff cannot read notes');
select is((select count(*)::int from public.patient_encryption_keys),0,'staff cannot read DEKs');
select throws_ok($$insert into storage.objects(bucket_id,name) values('practice-brand','forged.png')$$,'42501',null,'staff cannot overwrite practice branding');
select throws_ok($$insert into storage.objects(bucket_id,name) values('patient-documents','forged.pdf')$$,'42501',null,'staff cannot bypass validated upload');
reset role;

select pg_temp.impersonate('10000000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$select public.read_app_secret('anything')$$,'42501',null,'admin cannot read KEKs');
select throws_ok($$select private.hard_delete_patient_data(null)$$,'42501',null,'admin cannot hard delete');
select throws_ok($$select public.stage_billing_export_items('10000000-0000-0000-0000-000000000003','Nkanyezi Private Hospital','2026-01-01','{}')$$,'42501',null,'admin cannot stage billing');
select is((select count(*)::int from public.clinical_notes),0,'admin cannot read notes');
select is((select count(*)::int from public.patient_encryption_keys),0,'admin cannot read DEKs');
select throws_ok($$update public.app_users set role_id=(select id from public.roles where name='doctor') where id=auth.uid()$$,'42501',null,'admin cannot self-promote through the Data API');
select throws_ok($$update public.break_glass_requests set requested_at=now()$$,'42501',null,'admin cannot bypass break-glass timing through the Data API');
reset role;

-- A password-only JWT must fail at both role resolution and RLS.
select pg_temp.impersonate('10000000-0000-0000-0000-000000000002','aal1');
set local role authenticated;
select is(public.current_app_role(),null::public.role_name,'AAL1 staff has no application data role');
select is((select count(*)::int from public.patients),0,'AAL1 staff cannot read patients');
select is((select count(*)::int from public.app_users),1,'AAL1 still reads its own enrolment profile');
select throws_ok($$select public.stage_billing_export_items('10000000-0000-0000-0000-000000000002','Nkanyezi Private Hospital','2026-01-01','{}')$$,'42501',null,'AAL1 staff cannot stage billing');
reset role;
select pg_temp.impersonate('10000000-0000-0000-0000-000000000001','aal1');
set local role authenticated;
select is(public.current_app_role(),null::public.role_name,'AAL1 doctor has no application data role');
select is((select count(*)::int from public.patients),0,'AAL1 doctor cannot read patients');
reset role;
select pg_temp.impersonate('10000000-0000-0000-0000-000000000003','aal1');
set local role authenticated;
select is(public.current_app_role(),null::public.role_name,'AAL1 admin has no application data role');
select is((select count(*)::int from public.audit_logs),0,'AAL1 admin cannot read audit records');
reset role;

-- Server compatibility: private secret and lock implementations still work.
select private.create_app_secret('baseline-test-only','not-a-real-key','transactional fixture');
set local role service_role;
select is(public.read_app_secret('baseline-test-only'),'not-a-real-key','server wrapper reads private Vault secret');
select ok(public.try_acquire_maintenance_lock('outbox_drain',60),'server acquires lease');
select lives_ok($$select public.release_maintenance_lock('outbox_drain')$$,'server releases lease');
select throws_ok($$select private.update_app_secret('x','x','x')$$,'42501',null,'server cannot administer secrets');
reset role;
select * from finish();
rollback;
