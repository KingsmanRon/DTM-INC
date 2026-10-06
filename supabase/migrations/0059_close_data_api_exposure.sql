-- Close database objects the public Data API exposed beyond what the app uses.
--
-- Supabase's default privileges grant EXECUTE on new public functions and ALL
-- on new public tables directly to anon and authenticated. The earlier
-- "revoke ... from public" statements therefore left the Vault secret
-- wrappers, the hard-delete tooling and other server-only functions callable
-- with the public anon key, and audit_log_outbox readable and writable.
--
-- Behaviour-preserving for the application: every function revoked from
-- authenticated below is called only with the service role (server code,
-- cron, scripts), and operators run the secret/hard-delete helpers as postgres
-- in the SQL editor. Staff MFA,
-- break-glass timing and admin user management are unchanged.
begin;

-- 1. Server-only functions: no browser role may call them. allocate_file_number
--    and write_audit_entry lose anon in step 2 but keep authenticated until
--    every internal caller is confirmed to run as definer.
revoke execute on function
  public.read_app_secret(text),
  public.create_app_secret(text, text, text),
  public.update_app_secret(text, text, text),
  public.hard_delete_patient_data(uuid),
  public.try_acquire_maintenance_lock(text, integer),
  public.release_maintenance_lock(text),
  public.lease_patient_document_for_compression(uuid),
  public.swap_patient_document_to_compressed(uuid, text, text, text, text, bigint, text, integer),
  public.rollback_patient_document_compression(uuid, text),
  public.patient_document_compression_status_counts()
from public, anon, authenticated;

grant execute on function
  public.read_app_secret(text),
  public.create_app_secret(text, text, text),
  public.update_app_secret(text, text, text),
  public.hard_delete_patient_data(uuid),
  public.try_acquire_maintenance_lock(text, integer),
  public.release_maintenance_lock(text),
  public.lease_patient_document_for_compression(uuid),
  public.swap_patient_document_to_compressed(uuid, text, text, text, text, bigint, text, integer),
  public.rollback_patient_document_compression(uuid, text),
  public.patient_document_compression_status_counts()
to service_role;

-- 2. Signed-out callers need no application function. Revoke PUBLIC and anon
--    from every application function (extension-owned functions excluded);
--    authenticated and service_role keep their direct grants.
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon', f);
  end loop;
end
$$;

-- Functions the signed-in app calls under the user's JWT, or that RLS
-- policies (all scoped to authenticated) evaluate.
grant execute on function
  public.current_app_role(),
  public.get_my_app_profile(),
  public.is_admin(),
  public.is_doctor(),
  public.is_staff(),
  public.onboard_patient(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb),
  public.stage_billing_export_items(uuid, text, date, uuid[]),
  public.reassign_patient_hospital(uuid, text, text),
  public.void_clinical_note(uuid, text),
  public.update_patient_bundle(uuid, jsonb, jsonb, jsonb, jsonb, jsonb)
to authenticated;

-- New functions created by migrations stop being callable when signed out.
alter default privileges for role postgres in schema public revoke execute on functions from anon;

-- 3. The audit outbox is written and drained only with the service role.
alter table public.audit_log_outbox enable row level security;
revoke all on table public.audit_log_outbox from anon, authenticated;
do $$
declare
  s text := pg_get_serial_sequence('public.audit_log_outbox', 'id');
begin
  if s is not null then
    execute format('revoke all on sequence %s from anon, authenticated', s);
  end if;
end
$$;

-- 4. Role names stay readable to signed-in users and closed to everyone else.
alter table public.roles enable row level security;
drop policy if exists roles_read_authenticated on public.roles;
create policy roles_read_authenticated on public.roles
  for select to authenticated using (true);
revoke all on table public.roles from anon;
revoke insert, update, delete, truncate on table public.roles from authenticated;

-- 5. The policy named "deny" was permissive: it granted signed-in users every
--    operation on every bucket except patient-documents, including writing and
--    deleting the practice letterhead. Uploads use server-issued signed URLs
--    and branding is read server-side, so neither depends on it.
drop policy if exists "patient-documents deny all to authenticated" on storage.objects;

commit;
