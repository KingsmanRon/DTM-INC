begin;
-- Grants and policies only; no fixtures. Rolled back after the run.
create extension if not exists pgtap with schema extensions;
select plan(20);

-- Server-only functions are closed to signed-out and signed-in callers.
select ok(not has_function_privilege('anon', 'public.read_app_secret(text)', 'EXECUTE'), 'anon cannot read Vault secrets');
select ok(not has_function_privilege('authenticated', 'public.read_app_secret(text)', 'EXECUTE'), 'signed-in users cannot read Vault secrets');
select ok(not has_function_privilege('anon', 'public.update_app_secret(text,text,text)', 'EXECUTE'), 'anon cannot replace Vault secrets');
select ok(not has_function_privilege('authenticated', 'public.create_app_secret(text,text,text)', 'EXECUTE'), 'signed-in users cannot create Vault secrets');
select ok(not has_function_privilege('anon', 'public.hard_delete_patient_data(uuid)', 'EXECUTE'), 'anon cannot hard-delete patient data');
select ok(not has_function_privilege('authenticated', 'public.hard_delete_patient_data(uuid)', 'EXECUTE'), 'signed-in users cannot hard-delete patient data');
select ok(not has_function_privilege('authenticated', 'public.try_acquire_maintenance_lock(text,integer)', 'EXECUTE'), 'signed-in users cannot take maintenance leases');
select ok(not has_function_privilege('authenticated', 'public.lease_patient_document_for_compression(uuid)', 'EXECUTE'), 'signed-in users cannot drive document compression');
select ok(has_function_privilege('service_role', 'public.read_app_secret(text)', 'EXECUTE'), 'the server can still read the KEK');
select ok(has_function_privilege('service_role', 'public.try_acquire_maintenance_lock(text,integer)', 'EXECUTE'), 'cron jobs can still take maintenance leases');

-- Signed-out callers reach no application function; the signed-in app keeps its RPCs.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0, 'anon can execute no application function');
select ok(has_function_privilege('authenticated', 'public.onboard_patient(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)', 'EXECUTE'), 'signed-in users can still onboard patients');
select ok(has_function_privilege('authenticated', 'public.update_patient_bundle(uuid,jsonb,jsonb,jsonb,jsonb,jsonb)', 'EXECUTE'), 'signed-in users can still update patients');
select ok(has_function_privilege('authenticated', 'public.is_doctor()', 'EXECUTE'), 'RLS role helpers stay available to signed-in users');

-- Audit outbox is service-only.
select ok((select relrowsecurity from pg_class where oid = 'public.audit_log_outbox'::regclass), 'audit outbox has RLS enabled');
select ok(not has_table_privilege('anon', 'public.audit_log_outbox', 'SELECT'), 'anon cannot read the audit outbox');
select ok(not has_table_privilege('authenticated', 'public.audit_log_outbox', 'DELETE'), 'signed-in users cannot delete pending audit events');

-- Role names: readable when signed in, never writable.
select ok((select relrowsecurity from pg_class where oid = 'public.roles'::regclass), 'roles has RLS enabled');
select ok(not has_table_privilege('authenticated', 'public.roles', 'UPDATE'), 'signed-in users cannot change role definitions');

-- The permissive "deny" storage policy is gone.
select is(
  (select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and policyname = 'patient-documents deny all to authenticated'),
  0, 'signed-in users no longer get write access to non-patient buckets');

select * from finish();
rollback;
