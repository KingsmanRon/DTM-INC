-- Verification for migration 0033_optimize_rls_role_initplans.sql.
-- Run in Supabase SQL editor or psql after applying migrations.

-- 1) These queries should return zero rows: no RLS policy should directly call
-- the row-multiplied boolean helpers after this optimization.
select schemaname, tablename, policyname, qual, with_check
from pg_policies
where schemaname = 'public'
  and (
    coalesce(qual, '') ~ '(^|[^[:alnum:]_\.])is_doctor\s*\(\s*\)'
    or coalesce(with_check, '') ~ '(^|[^[:alnum:]_\.])is_doctor\s*\(\s*\)'
  )
order by tablename, policyname;

select schemaname, tablename, policyname, qual, with_check
from pg_policies
where schemaname = 'public'
  and (
    coalesce(qual, '') ~ '(^|[^[:alnum:]_\.])is_staff\s*\(\s*\)'
    or coalesce(with_check, '') ~ '(^|[^[:alnum:]_\.])is_staff\s*\(\s*\)'
  )
order by tablename, policyname;

select schemaname, tablename, policyname, qual, with_check
from pg_policies
where schemaname = 'public'
  and (
    coalesce(qual, '') ~ '(^|[^[:alnum:]_\.])is_admin\s*\(\s*\)'
    or coalesce(with_check, '') ~ '(^|[^[:alnum:]_\.])is_admin\s*\(\s*\)'
  )
order by tablename, policyname;

-- 2) These expected policies should all show found_current_app_role = true.
with expected(policyname, tablename) as (
  values
    ('patients_clinical_read', 'patients'),
    ('patients_clinical_update', 'patients'),
    ('patients_clinical_write', 'patients'),
    ('patient_dependants_clinical_read', 'patient_dependants'),
    ('patient_dependants_clinical_insert', 'patient_dependants'),
    ('patient_dependants_clinical_update', 'patient_dependants'),
    ('patient_medical_aid_clinical_read', 'patient_medical_aid'),
    ('patient_medical_aid_clinical_insert', 'patient_medical_aid'),
    ('patient_medical_aid_clinical_update', 'patient_medical_aid'),
    ('patient_documents_clinical_read', 'patient_documents'),
    ('patient_documents_clinical_insert', 'patient_documents'),
    ('patient_documents_clinical_update', 'patient_documents'),
    ('patient_emergency_contacts_clinical_read', 'patient_emergency_contacts'),
    ('patient_emergency_contacts_clinical_insert', 'patient_emergency_contacts'),
    ('patient_emergency_contacts_clinical_update', 'patient_emergency_contacts'),
    ('patient_referrals_clinical_read', 'patient_referrals'),
    ('patient_referrals_clinical_insert', 'patient_referrals'),
    ('patient_referrals_clinical_update', 'patient_referrals'),
    ('patient_account_responsible_clinical_read', 'patient_account_responsible'),
    ('patient_account_responsible_clinical_insert', 'patient_account_responsible'),
    ('patient_account_responsible_clinical_update', 'patient_account_responsible'),
    ('consent_records_clinical_read', 'consent_records'),
    ('consent_records_clinical_insert', 'consent_records'),
    ('consent_records_clinical_update', 'consent_records'),
    ('clinical_notes_doctor_only', 'clinical_notes'),
    ('patient_encryption_keys_doctor_read', 'patient_encryption_keys'),
    ('app_users_admin_write', 'app_users'),
    ('app_users_self_read', 'app_users'),
    ('audit_logs_admin_all', 'audit_logs'),
    ('audit_logs_doctor_break_glass', 'audit_logs'),
    ('audit_logs_doctor_own', 'audit_logs'),
    ('break_glass_admin', 'break_glass_requests'),
    ('break_glass_doctor_read', 'break_glass_requests'),
    ('practice_settings_admin_write', 'practice_settings'),
    ('user_invites_admin', 'user_invites')
)
select
  e.tablename,
  e.policyname,
  p.policyname is not null as policy_exists,
  (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ilike '%select%current_app_role%' as found_current_app_role,
  p.qual,
  p.with_check
from expected e
left join pg_policies p
  on p.schemaname = 'public'
 and p.tablename = e.tablename
 and p.policyname = e.policyname
order by e.tablename, e.policyname;

-- 3) current_app_role() should be SECURITY DEFINER and have an explicit safe
-- search_path set by the migration.
select
  n.nspname as schema,
  p.proname as function_name,
  p.prosecdef as security_definer,
  p.provolatile as volatility,
  p.proconfig as function_settings
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'current_app_role';
