-- Duplicate patient identity remediation runbook.
--
-- Run this manually in Supabase SQL Editor before applying migration
-- 0031_prevent_duplicate_patient_identity.sql if that migration raises
-- duplicate_patient_identity_existing_rows.
--
-- Why this is not part of the migration:
--   * This is a POPIA-sensitive clinical record system.
--   * A duplicate patient row may already have clinical notes, documents,
--     break-glass requests, or other medico-legal history.
--   * The schema uses ON DELETE RESTRICT on patient child tables by design.
--   * Therefore the database must not guess which file to delete or merge.
--
-- Recommended policy:
--   1. Use the reports below to identify duplicates and choose the keeper.
--      Usually keep the row with clinical notes/documents, or otherwise the
--      oldest/original file number.
--   2. The guarded hard-delete block does NOT choose newest/oldest for you.
--      It deletes only the specific duplicate file number/UUID you enter in
--      v_duplicate_file_number / v_duplicate_patient_id.
--   3. Only use the guarded hard-delete block for an empty duplicate onboarding
--      shell: no clinical notes, no documents, and no break-glass requests.
--   4. If both rows contain clinical material, do NOT delete either row using
--      this script. Escalate to a clinical/admin merge decision and document the
--      resolution in the audit trail.
--   5. After remediation, re-run migration 0031 to install the unique index so
--      this cannot recur for normalized SA ID/passport identities.

-- ──────────────────────────────────────────────────────────────────────────
-- 1) Duplicate identity groups.
-- ──────────────────────────────────────────────────────────────────────────
with patient_identity as (
  select
    id,
    file_number,
    id_type,
    case when id_type = 'passport' then upper(coalesce(id_country, '')) else '' end as normalized_country,
    upper(btrim(id_number)) as normalized_id_number,
    first_names,
    surname,
    archived_at,
    created_at,
    updated_at
  from public.patients
  where id_type <> 'none_minor'
    and coalesce(btrim(id_number), '') <> ''
), duplicate_groups as (
  select id_type, normalized_country, normalized_id_number
  from patient_identity
  group by 1, 2, 3
  having count(*) > 1
)
select
  pi.*,
  count(*) over (partition by pi.id_type, pi.normalized_country, pi.normalized_id_number) as duplicate_count
from patient_identity pi
join duplicate_groups dg using (id_type, normalized_country, normalized_id_number)
order by pi.id_type, pi.normalized_country, pi.normalized_id_number, pi.created_at, pi.file_number;

-- ──────────────────────────────────────────────────────────────────────────
-- 2) Child-row inventory for each duplicate candidate.
--    Use this to decide whether a row is an empty duplicate shell.
-- ──────────────────────────────────────────────────────────────────────────
with duplicate_patients as (
  with patient_identity as (
    select
      id,
      file_number,
      id_type,
      case when id_type = 'passport' then upper(coalesce(id_country, '')) else '' end as normalized_country,
      upper(btrim(id_number)) as normalized_id_number,
      created_at
    from public.patients
    where id_type <> 'none_minor'
      and coalesce(btrim(id_number), '') <> ''
  ), duplicate_groups as (
    select id_type, normalized_country, normalized_id_number
    from patient_identity
    group by 1, 2, 3
    having count(*) > 1
  )
  select pi.*
  from patient_identity pi
  join duplicate_groups dg using (id_type, normalized_country, normalized_id_number)
)
select
  p.id,
  p.file_number,
  p.id_type,
  p.normalized_country,
  p.normalized_id_number,
  p.created_at,
  (select count(*) from public.patient_account_responsible x where x.patient_id = p.id) as account_responsible_rows,
  (select count(*) from public.patient_medical_aid x where x.patient_id = p.id) as medical_aid_rows,
  (select count(*) from public.patient_emergency_contacts x where x.patient_id = p.id) as emergency_contact_rows,
  (select count(*) from public.patient_referrals x where x.patient_id = p.id) as referral_rows,
  (select count(*) from public.patient_dependants x where x.patient_id = p.id) as dependant_rows,
  (select count(*) from public.consent_records x where x.patient_id = p.id) as consent_rows,
  (select count(*) from public.patient_documents x where x.patient_id = p.id) as document_rows,
  (select count(*) from public.clinical_notes x where x.patient_id = p.id) as clinical_note_rows,
  (select count(*) from public.break_glass_requests x where x.target_patient_id = p.id) as break_glass_rows,
  (select count(*) from public.audit_logs x where x.patient_id = p.id) as audit_rows,
  (
    (select count(*) from public.patient_documents x where x.patient_id = p.id) = 0
    and (select count(*) from public.clinical_notes x where x.patient_id = p.id) = 0
    and (select count(*) from public.break_glass_requests x where x.target_patient_id = p.id) = 0
  ) as can_consider_empty_shell_delete
from duplicate_patients p
order by p.id_type, p.normalized_country, p.normalized_id_number, p.created_at, p.file_number;

-- ──────────────────────────────────────────────────────────────────────────
-- 3) Guarded deletion for an EMPTY duplicate onboarding shell only.
--
-- Replace either the file numbers OR the UUIDs below, run the transaction,
-- inspect the NOTICE output, and change ROLLBACK to COMMIT only after
-- clinical/admin approval.
--
-- Example for the screenshot:
--   v_keep_file_number := 'NKA-2026-000001';
--   v_duplicate_file_number := 'NKA-2026-000128';
--
-- The script never deletes "latest" or "oldest" automatically; it deletes only
-- the row resolved from v_duplicate_file_number / v_duplicate_patient_id after
-- all guards pass.
-- ──────────────────────────────────────────────────────────────────────────
begin;

do $$
declare
  -- Prefer file numbers because they are visible in the UI. Leave either value
  -- null if you choose to set the UUID directly instead.
  v_keep_file_number text := null; -- e.g. 'NKA-2026-000001'
  v_duplicate_file_number text := null; -- e.g. 'NKA-2026-000128'

  v_keep_patient_id uuid := null;
  v_duplicate_patient_id uuid := null;
  v_same_identity boolean;
  v_blocking_rows int;
begin
  if v_keep_file_number is not null then
    select id into v_keep_patient_id
    from public.patients
    where file_number = v_keep_file_number;
  end if;

  if v_duplicate_file_number is not null then
    select id into v_duplicate_patient_id
    from public.patients
    where file_number = v_duplicate_file_number;
  end if;

  if v_keep_patient_id is null or v_duplicate_patient_id is null then
    raise exception 'set_keeper_and_duplicate_patient_ids_or_file_numbers';
  end if;

  if v_keep_patient_id = v_duplicate_patient_id then
    raise exception 'keeper_and_duplicate_must_differ';
  end if;

  select exists (
    select 1
    from public.patients keep
    join public.patients dup on true
    where keep.id = v_keep_patient_id
      and dup.id = v_duplicate_patient_id
      and keep.id_type = dup.id_type
      and keep.id_type <> 'none_minor'
      and case
        when keep.id_type = 'passport' then upper(coalesce(keep.id_country, '')) = upper(coalesce(dup.id_country, ''))
        else true
      end
      and upper(btrim(keep.id_number)) = upper(btrim(dup.id_number))
      and coalesce(btrim(keep.id_number), '') <> ''
      and coalesce(btrim(dup.id_number), '') <> ''
  ) into v_same_identity;

  if not v_same_identity then
    raise exception 'patients_do_not_share_the_same_normalized_identity';
  end if;

  select
    (select count(*) from public.patient_documents where patient_id = v_duplicate_patient_id) +
    (select count(*) from public.clinical_notes where patient_id = v_duplicate_patient_id) +
    (select count(*) from public.break_glass_requests where target_patient_id = v_duplicate_patient_id)
  into v_blocking_rows;

  if v_blocking_rows > 0 then
    raise exception 'duplicate_patient_has_clinical_or_break_glass_history'
      using detail = 'Do not hard-delete. Plan a documented clinical merge/archive instead.';
  end if;

  -- These rows are part of the erroneous onboarding shell. They are deleted only
  -- after the guards above prove the duplicate has no clinical/document history.
  delete from public.patient_account_responsible where patient_id = v_duplicate_patient_id;
  delete from public.patient_medical_aid where patient_id = v_duplicate_patient_id;
  delete from public.patient_emergency_contacts where patient_id = v_duplicate_patient_id;
  delete from public.patient_referrals where patient_id = v_duplicate_patient_id;
  delete from public.patient_dependants where patient_id = v_duplicate_patient_id;
  delete from public.consent_records where patient_id = v_duplicate_patient_id;
  delete from public.patient_encryption_keys where patient_id = v_duplicate_patient_id;
  delete from public.patients where id = v_duplicate_patient_id;

  raise notice 'Deleted empty duplicate patient shell %. Keeper patient is %.', v_duplicate_patient_id, v_keep_patient_id;
end $$;

-- Safety default. Change to COMMIT only after reviewing the NOTICE output and
-- obtaining the required clinical/admin approval.
rollback;
