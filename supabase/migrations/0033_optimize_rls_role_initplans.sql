-- Optimize role-based RLS policy predicates so current_app_role() is evaluated
-- once per statement as an initPlan instead of being multiplied per scanned row.
--
-- Security intent is unchanged:
--   * doctor/staff clinical access remains doctor OR staff;
--   * clinical notes remain doctor-only;
--   * patient encryption keys remain doctor-only;
--   * admin-only policies remain admin-only;
--   * no grants are added, and RLS remains enabled.

set statement_timeout = 0;

-- current_app_role() is SECURITY DEFINER, so pin its search_path and fully
-- qualify application objects. This preserves the original active-user role
-- lookup while avoiding search_path hijacking surprises in definer context.
create or replace function public.current_app_role()
returns public.role_name
language sql
stable
security definer
set search_path = ''
as $function$
  select r.name
  from public.app_users u
  join public.roles r on r.id = u.role_id
  where u.id = auth.uid()
    and u.status = 'active';
$function$;

grant execute on function public.current_app_role() to authenticated;

-- Common policy expressions used below. Kept inline because ALTER POLICY does
-- not accept variables/macros:
--   doctor/staff: (select public.current_app_role()) in ('doctor'::public.role_name, 'staff'::public.role_name)
--   doctor:       (select public.current_app_role()) = 'doctor'::public.role_name
--   admin:        (select public.current_app_role()) = 'admin'::public.role_name

-- app_users: self-read remains self OR admin; writes remain admin-only.
alter policy app_users_self_read on public.app_users
  using (
    (id = auth.uid())
    or ((select public.current_app_role()) = 'admin'::public.role_name)
  );

alter policy app_users_admin_write on public.app_users
  using ((select public.current_app_role()) = 'admin'::public.role_name)
  with check ((select public.current_app_role()) = 'admin'::public.role_name);

-- patients: doctor/staff clinical access unchanged.
alter policy patients_clinical_read on public.patients
  using ((select public.current_app_role()) in ('doctor'::public.role_name, 'staff'::public.role_name));

alter policy patients_clinical_write on public.patients
  with check ((select public.current_app_role()) in ('doctor'::public.role_name, 'staff'::public.role_name));

alter policy patients_clinical_update on public.patients
  using ((select public.current_app_role()) in ('doctor'::public.role_name, 'staff'::public.role_name))
  with check ((select public.current_app_role()) in ('doctor'::public.role_name, 'staff'::public.role_name));

-- Patient sub-resources inherit the same doctor/staff clinical rule.
do $$
declare
  table_name text;
  read_policy text;
  insert_policy text;
  update_policy text;
  clinical_role_expr text := '(select public.current_app_role()) in (''doctor''::public.role_name, ''staff''::public.role_name)';
begin
  foreach table_name in array array[
    'patient_dependants',
    'patient_medical_aid',
    'patient_documents',
    'patient_emergency_contacts',
    'patient_referrals',
    'patient_account_responsible',
    'consent_records'
  ] loop
    read_policy := table_name || '_clinical_read';
    insert_policy := table_name || '_clinical_insert';
    update_policy := table_name || '_clinical_update';

    execute format('alter policy %I on public.%I using (%s)', read_policy, table_name, clinical_role_expr);
    execute format('alter policy %I on public.%I with check (%s)', insert_policy, table_name, clinical_role_expr);
    execute format('alter policy %I on public.%I using (%s) with check (%s)', update_policy, table_name, clinical_role_expr, clinical_role_expr);
  end loop;
end $$;

-- Doctor-only policies: stay doctor-only.
alter policy clinical_notes_doctor_only on public.clinical_notes
  using ((select public.current_app_role()) = 'doctor'::public.role_name)
  with check ((select public.current_app_role()) = 'doctor'::public.role_name);

alter policy patient_encryption_keys_doctor_read on public.patient_encryption_keys
  using ((select public.current_app_role()) = 'doctor'::public.role_name);

-- Audit logs: doctor-own/break-glass and admin-all semantics unchanged.
alter policy audit_logs_doctor_own on public.audit_logs
  using (
    ((select public.current_app_role()) = 'doctor'::public.role_name)
    and (actor_user_id = auth.uid())
  );

alter policy audit_logs_admin_all on public.audit_logs
  using ((select public.current_app_role()) = 'admin'::public.role_name);

alter policy audit_logs_doctor_break_glass on public.audit_logs
  using (
    ((select public.current_app_role()) = 'doctor'::public.role_name)
    and action in ('break_glass_request', 'break_glass_access')
  );

-- Break-glass policies: admin remains admin; doctor read remains doctor-only.
alter policy break_glass_admin on public.break_glass_requests
  using ((select public.current_app_role()) = 'admin'::public.role_name)
  with check ((select public.current_app_role()) = 'admin'::public.role_name);

alter policy break_glass_doctor_read on public.break_glass_requests
  using ((select public.current_app_role()) = 'doctor'::public.role_name);

-- Remaining admin-only policies.
alter policy practice_settings_admin_write on public.practice_settings
  using ((select public.current_app_role()) = 'admin'::public.role_name)
  with check ((select public.current_app_role()) = 'admin'::public.role_name);

alter policy user_invites_admin on public.user_invites
  using ((select public.current_app_role()) = 'admin'::public.role_name)
  with check ((select public.current_app_role()) = 'admin'::public.role_name);
