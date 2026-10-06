begin;
-- Synthetic fixtures only; rolled back after every run.
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into public.hospitals(name,file_prefix,display_order) values ('Example Backup Facility','BKP',10);
insert into auth.users(id,email) values ('33000000-0000-4000-8000-000000000001','staff@backup.test');
insert into public.app_users(id,email,full_name,role_id,status)
select '33000000-0000-4000-8000-000000000001','staff@backup.test','Backup test',r.id,'active' from public.roles r where r.name = 'staff';
insert into public.patients(id,file_number,hospital,title,first_names,surname,id_type,id_number,id_country,phone,address) values
 ('34000000-0000-4000-8000-000000000001','BKP-2026-000001','Example Backup Facility','Mr','Backup','Example','passport','BKP001','ZA','0001234','Test only');
insert into public.patient_documents(id,patient_id,category,storage_key,original_filename,mime_type,file_size,sha256_hash,uploaded_by,uploaded_at,
                                     original_storage_key,original_sha256_hash,original_file_size,original_mime_type,storage_object_deleted_at) values
 ('35000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001','pathology_result','p/1/a.pdf','a.pdf','application/pdf',10,repeat('a',64),'33000000-0000-4000-8000-000000000001','2026-10-01',null,null,null,null,null),
 ('35000000-0000-4000-8000-000000000002','34000000-0000-4000-8000-000000000001','imaging_report','p/2/v1.jpg','b.jpg','image/jpeg',10,repeat('b',64),'33000000-0000-4000-8000-000000000001','2026-10-02','p/2/orig.png',repeat('c',64),20,'image/png',null),
 ('35000000-0000-4000-8000-000000000003','34000000-0000-4000-8000-000000000001','other','p/3/gone.pdf','c.pdf','application/pdf',10,repeat('d',64),'33000000-0000-4000-8000-000000000001','2026-10-03',null,null,null,null,'2026-10-04');

select results_eq(
  $$ select storage_key, object_kind, mime_type from public.documents_pending_backup(50) $$,
  $$ values ('p/1/a.pdf','active','application/pdf'), ('p/2/orig.png','original','image/png'), ('p/2/v1.jpg','active','image/jpeg') $$,
  'active objects and retained originals are pending; deliberately removed archived bytes are not');
select is(public.documents_pending_backup_count(), 3::bigint, 'pending count matches the pending list');

insert into public.patient_document_backups(storage_key,document_id,object_kind,sha256_hash,status,s3_key,attempts,backed_up_at)
values ('p/1/a.pdf','35000000-0000-4000-8000-000000000001','active',repeat('a',64),'backed_up','patient-documents/p/1/a.pdf',1,now());
select is(public.documents_pending_backup_count(), 2::bigint, 'a backed-up object is no longer pending');

insert into public.patient_document_backups(storage_key,document_id,object_kind,sha256_hash,status,attempts,last_error)
values ('p/2/v1.jpg','35000000-0000-4000-8000-000000000002','active',repeat('b',64),'failed',4,'s3_put_failed');
select is((select attempts from public.documents_pending_backup(50) where storage_key = 'p/2/v1.jpg'), 4, 'a failed object is retried and reports its attempts');
update public.patient_document_backups set attempts = 5 where storage_key = 'p/2/v1.jpg';
select is(public.documents_pending_backup_count(), 1::bigint, 'an object that failed five times stops being retried');

select throws_ok($$ insert into public.patient_document_backups(storage_key,document_id,object_kind,sha256_hash,status) values ('x','35000000-0000-4000-8000-000000000001','active','x','lost') $$,
  '23514', null, 'only known backup statuses are accepted');

select ok(not has_table_privilege('authenticated', 'public.patient_document_backups', 'SELECT'), 'signed-in users cannot read the backup ledger');
select ok(not has_table_privilege('anon', 'public.patient_document_backups', 'SELECT'), 'anonymous users cannot read the backup ledger');
select ok(not has_function_privilege('authenticated', 'public.documents_pending_backup(integer)', 'EXECUTE'), 'signed-in users cannot list pending backups');
select ok(not has_function_privilege('anon', 'public.documents_pending_backup_count()', 'EXECUTE'), 'anonymous users cannot count pending backups');
select ok(has_function_privilege('service_role', 'public.documents_pending_backup(integer)', 'EXECUTE'), 'the backup job (service role) can list pending backups');

select ok(public.try_acquire_maintenance_lock('document_backup', 60), 'the backup job can take its maintenance lease');

insert into public.patient_document_backups(storage_key,document_id,object_kind,sha256_hash,status,attempts,last_error)
values ('p/2/orig.png','35000000-0000-4000-8000-000000000002','original',repeat('c',64),'original_removed',1,'original_deleted_from_storage');
select is((select count(*)::int from public.documents_pending_backup(50) where storage_key = 'p/2/orig.png'), 0, 'a deleted original is not retried');
select is(public.documents_pending_backup_count(), 0::bigint, 'nothing is pending once every object is backed up, removed or out of retries');

select * from finish();
rollback;
