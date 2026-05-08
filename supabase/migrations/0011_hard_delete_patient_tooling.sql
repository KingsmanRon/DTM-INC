-- Hard-delete helper for non-production data cleanup (E2E dummy data).
-- WARNING: irreversible. Intended for controlled admin/service-role execution.

create or replace function public.hard_delete_patient_data(p_patient_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_patient_id is null then
    raise exception 'p_patient_id is required' using errcode = '22023';
  end if;

  delete from break_glass_requests where target_patient_id = p_patient_id;
  delete from clinical_notes where patient_id = p_patient_id;
  delete from patient_encryption_keys where patient_id = p_patient_id;
  delete from patient_documents where patient_id = p_patient_id;
  delete from consent_records where patient_id = p_patient_id;
  delete from patient_dependants where patient_id = p_patient_id;
  delete from patient_referrals where patient_id = p_patient_id;
  delete from patient_emergency_contacts where patient_id = p_patient_id;
  delete from patient_medical_aid where patient_id = p_patient_id;
  delete from patient_account_responsible where patient_id = p_patient_id;

  -- Audit logs are append-only and intentionally retained.
  delete from patients where id = p_patient_id;
end;
$$;

revoke all on function public.hard_delete_patient_data(uuid) from public;
grant execute on function public.hard_delete_patient_data(uuid) to service_role;
