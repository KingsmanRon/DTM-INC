-- 0043_consent_records_immutable.sql — make consent immutability real at the DB layer.
--
-- WHY: 0001 documents consent_records as IMMUTABLE ("No updates — new rows only"),
-- but the 0002 sub-resource policy loop blanket-created an UPDATE policy for it
-- (consent_records_clinical_update), and 0033 re-asserted that policy's predicate.
-- No application code updates consents, but defence-in-depth says the database
-- must refuse, not merely the app decline to try. A signed POPIA consent that can
-- be silently edited after the fact undermines the whole record.
--
-- Three layers applied here:
--   1. Drop the erroneous UPDATE policy (no path under RLS).
--   2. Revoke UPDATE/DELETE privileges from app roles (no path even if a future
--      policy reappears).
--   3. BEFORE UPDATE OR DELETE trigger (no path even via service_role/definer
--      code — corrections happen by capturing a NEW consent row).

begin;

drop policy if exists consent_records_clinical_update on public.consent_records;

revoke update, delete on public.consent_records from authenticated;
revoke update, delete on public.consent_records from anon;

create or replace function public.prevent_consent_record_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'consent_records are immutable: capture a new consent row instead of % on %',
    lower(tg_op), old.id
    using errcode = 'PT409';
end;
$$;

drop trigger if exists consent_records_immutable on public.consent_records;
create trigger consent_records_immutable
  before update or delete on public.consent_records
  for each row execute function public.prevent_consent_record_mutation();

commit;

-- POST-APPLY VERIFICATION:
--   1. As staff/doctor: UPDATE public.consent_records ... -> permission denied (no grant).
--   2. Via service_role: UPDATE -> PT409 from the trigger.
--   3. Onboarding a new patient still inserts a consent row normally.
