-- Row-Level Security policies (§10.1 layer 3).
-- Relies on Supabase Auth populating auth.uid() and a helper function that
-- reads the caller's role from app_users.

set statement_timeout = 0;

-- ═══════════════════════════════════════════════════════════════════════════
-- DEDICATED DB ROLES
-- ═══════════════════════════════════════════════════════════════════════════

-- Audit writer: INSERT-only on audit_logs. The Railway service uses a
-- dedicated Postgres connection under this role for audit writes, so even a
-- compromised service-role key cannot UPDATE or DELETE an audit row.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'audit_writer') then
    create role audit_writer noinherit nologin;
  end if;
end $$;

revoke all on audit_logs from public;
grant insert, select on audit_logs to audit_writer;
-- Explicitly do NOT grant update/delete/truncate to anyone. No role has it.

-- Standard service_role keeps its broad privileges for non-audit tables, but
-- UPDATE/DELETE on audit_logs is revoked even from service_role.
revoke update, delete, truncate on audit_logs from service_role;
revoke update, delete, truncate on audit_logs from authenticated;
revoke update, delete, truncate on audit_logs from anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLE LOOKUP HELPER
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function current_app_role()
returns role_name language sql stable security definer as $$
  select r.name
  from app_users u
  join roles r on r.id = u.role_id
  where u.id = auth.uid()
    and u.status = 'active';
$$;

grant execute on function current_app_role() to authenticated;

create or replace function is_doctor() returns boolean
  language sql stable as $$ select current_app_role() = 'doctor' $$;
create or replace function is_staff()  returns boolean
  language sql stable as $$ select current_app_role() = 'staff' $$;
create or replace function is_admin()  returns boolean
  language sql stable as $$ select current_app_role() = 'admin' $$;

grant execute on function is_doctor() to authenticated;
grant execute on function is_staff()  to authenticated;
grant execute on function is_admin()  to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ENABLE RLS
-- ═══════════════════════════════════════════════════════════════════════════

alter table app_users                     enable row level security;
alter table patients                      enable row level security;
alter table patient_account_responsible   enable row level security;
alter table patient_medical_aid           enable row level security;
alter table patient_emergency_contacts    enable row level security;
alter table patient_referrals             enable row level security;
alter table patient_dependants            enable row level security;
alter table patient_documents             enable row level security;
alter table consent_records               enable row level security;
alter table clinical_notes                enable row level security;
alter table patient_encryption_keys       enable row level security;
alter table audit_logs                    enable row level security;
alter table user_invites                  enable row level security;
alter table break_glass_requests          enable row level security;
alter table practice_settings             enable row level security;
alter table file_number_sequences         enable row level security;

-- ═══════════════════════════════════════════════════════════════════════════
-- POLICIES
-- ═══════════════════════════════════════════════════════════════════════════

-- app_users: each user reads their own row; admins read and write all.
create policy app_users_self_read on app_users
  for select to authenticated using (id = auth.uid() or is_admin());
create policy app_users_admin_write on app_users
  for all to authenticated using (is_admin()) with check (is_admin());

-- patients: staff + doctor read/write; admin NO read of demographics (authz
-- matrix §9). Admin can archive, handled via server-side with service role.
create policy patients_clinical_read on patients
  for select to authenticated using (is_doctor() or is_staff());
create policy patients_clinical_write on patients
  for insert to authenticated with check (is_doctor() or is_staff());
create policy patients_clinical_update on patients
  for update to authenticated using (is_doctor() or is_staff())
  with check (is_doctor() or is_staff());

-- Sub-resources inherit the patient visibility rule.
do $$
declare t text;
begin
  foreach t in array array[
    'patient_account_responsible', 'patient_medical_aid',
    'patient_emergency_contacts', 'patient_referrals',
    'patient_dependants', 'patient_documents', 'consent_records'
  ] loop
    execute format('create policy %I_clinical_read on %I for select to authenticated using (is_doctor() or is_staff())', t, t);
    execute format('create policy %I_clinical_insert on %I for insert to authenticated with check (is_doctor() or is_staff())', t, t);
    execute format('create policy %I_clinical_update on %I for update to authenticated using (is_doctor() or is_staff()) with check (is_doctor() or is_staff())', t, t);
  end loop;
end $$;

-- Clinical notes: DOCTOR ONLY. No other role can read, write, or even know
-- the row count. Any break-glass read by admin goes through the service role
-- AFTER break_glass_requests row is validated — not through RLS.
create policy clinical_notes_doctor_only on clinical_notes
  for all to authenticated using (is_doctor()) with check (is_doctor());

-- Encryption keys: doctor can read (to decrypt), service role manages. Staff
-- and admin get zero visibility.
create policy patient_encryption_keys_doctor_read on patient_encryption_keys
  for select to authenticated using (is_doctor());

-- Audit logs: doctor sees own actions, admin sees all, staff sees nothing.
create policy audit_logs_doctor_own on audit_logs
  for select to authenticated using (is_doctor() and actor_user_id = auth.uid());
create policy audit_logs_admin_all on audit_logs
  for select to authenticated using (is_admin());

-- User invites: admin only.
create policy user_invites_admin on user_invites
  for all to authenticated using (is_admin()) with check (is_admin());

-- Break-glass: admin (requester) and doctor (recipient of notification).
create policy break_glass_admin on break_glass_requests
  for all to authenticated using (is_admin()) with check (is_admin());
create policy break_glass_doctor_read on break_glass_requests
  for select to authenticated using (is_doctor());

-- Practice settings: everyone reads (for header/footer); admin writes.
create policy practice_settings_read on practice_settings
  for select to authenticated using (true);
create policy practice_settings_admin_write on practice_settings
  for update to authenticated using (is_admin()) with check (is_admin());

-- File number sequences: no direct access. allocate_file_number() is security definer.
-- (No policies = nothing allowed under RLS.)

-- ═══════════════════════════════════════════════════════════════════════════
-- REVOKE broad grants so RLS actually gates access
-- ═══════════════════════════════════════════════════════════════════════════

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

-- Re-grant the minimum for RLS-governed operations.
grant select, insert, update on
  app_users,
  patients,
  patient_account_responsible,
  patient_medical_aid,
  patient_emergency_contacts,
  patient_referrals,
  patient_dependants,
  patient_documents,
  consent_records,
  clinical_notes,
  patient_encryption_keys,
  user_invites,
  break_glass_requests,
  practice_settings
to authenticated;

grant select on audit_logs to authenticated;
grant select on roles to authenticated;
