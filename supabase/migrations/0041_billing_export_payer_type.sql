-- 0041_billing_export_payer_type.sql — carry the patient's payer type into the
-- monthly billing export so cash (private) patients are explicit, not blank.
--
-- WHY: patients.payer_type ('medical_aid' | 'private') has existed since 0001
-- and is set at onboarding by the "Private payer (no medical aid)" checkbox —
-- but the billing snapshot never carried it. A cash patient staged into a
-- batch surfaced as a blank Medical Aid Number, indistinguishable from a
-- medical-aid patient whose membership number was never captured. The third-
-- party billing company needs the difference: blank = data missing (chase the
-- practice), CASH = private payer (bill the patient directly). The CASH label
-- itself is applied app-side when the spreadsheet/batch row is rendered; the
-- database stores only the enum snapshot.
--
-- DESIGN CONSTRAINTS HONOURED (same preamble as 0036):
--   1.1  No trigger. updated_at remains maintained explicitly in the write
--        paths. The backfill below deliberately does NOT bump updated_at /
--        updated_by: it materialises an attribute those rows already had at
--        stage time, not a user edit.
--   1.5  No grant beyond the existing authenticated posture is added or
--        widened; the function re-grant below re-asserts the 0036 state.
--   3.4  RLS untouched: the new column rides the existing doctor/staff
--        policies on billing_export_items.
--   4    Upsert key and ON CONFLICT semantics unchanged; payer_type is
--        refreshed on re-stage exactly like the other snapshot fields.
--   1.4  Billing fields only — still never references clinical content.
--
-- The column is intentionally NULLABLE: the backfill fills every existing row
-- (patients.payer_type is NOT NULL and every item references a patient), and
-- the replaced RPC always writes it for new/refreshed rows — but readers treat
-- NULL as "unknown" and fall back to the pre-0041 rendering (membership number
-- or blank), so the migration/deploy window can never mislabel a row as CASH.

begin;

set statement_timeout = 0;

alter table public.billing_export_items
  add column if not exists payer_type public.payer_type;

comment on column public.billing_export_items.payer_type is
  'Snapshot of patients.payer_type at stage/refresh time. ''private'' renders as CASH in '
  'the batch screen and the exported spreadsheet; NULL (legacy rows staged before 0041) '
  'falls back to membership-number-or-blank.';

-- Backfill rows staged before this migration from the live patient record.
-- Plain UPDATE (no updated_at/updated_by bump — see preamble 1.1).
update public.billing_export_items bei
  set payer_type = p.payer_type
  from public.patients p
  where p.id = bei.patient_id
    and bei.payer_type is null;

-- Re-create the staging upsert with payer_type included in both the INSERT
-- and the ON CONFLICT refresh. Signature, SECURITY DEFINER posture, role
-- re-check and search_path pinning are byte-identical to 0036 — the only
-- additions are the payer_type column, its select expression, and its
-- conflict-update assignment.
create or replace function public.stage_billing_export_items(
  p_actor_user_id uuid,
  p_hospital      text,
  p_export_month  date,
  p_patient_ids   uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role  public.role_name;
  v_count integer;
begin
  v_role := (select public.current_app_role());
  if v_role is null or v_role not in ('doctor', 'staff') then
    raise exception 'billing export staging is restricted to staff and doctor'
      using errcode = '42501';
  end if;

  if p_export_month is distinct from date_trunc('month', p_export_month)::date then
    raise exception 'export_month must be the first day of the month';
  end if;

  insert into public.billing_export_items as bei (
    patient_id, hospital, export_month, file_number, patient_name,
    id_number, id_type, medical_aid_number, payer_type, status,
    created_by, updated_by, created_at, updated_at
  )
  select
    p.id,
    p.hospital,
    p_export_month,
    p.file_number,
    btrim(regexp_replace(concat_ws(' ', p.first_names, p.surname), '\s+', ' ', 'g')),
    p.id_number,
    p.id_type,
    ma.membership_number,
    p.payer_type,
    'pending'::public.billing_export_status,
    p_actor_user_id,
    p_actor_user_id,
    now(),
    now()
  from public.patients p
  left join public.patient_medical_aid ma on ma.patient_id = p.id
  where p.id = any(p_patient_ids)
    and p.hospital = p_hospital
    and p.status = 'active'
  on conflict (patient_id, hospital, export_month) do update
    set file_number        = excluded.file_number,
        patient_name       = excluded.patient_name,
        id_number          = excluded.id_number,
        id_type            = excluded.id_type,
        medical_aid_number = excluded.medical_aid_number,
        payer_type         = excluded.payer_type,
        updated_by         = excluded.updated_by,
        updated_at         = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.stage_billing_export_items(uuid, text, date, uuid[]) from public;
grant execute on function public.stage_billing_export_items(uuid, text, date, uuid[]) to authenticated;

commit;
