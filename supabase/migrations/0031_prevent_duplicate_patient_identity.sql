-- Prevent duplicate patient files for the same legal identity.
--
-- This intentionally does not weaken RLS or grant any table access. It adds a
-- table-level uniqueness guard so retries, double-submits, and concurrent
-- onboarding requests cannot create a second patient row with the same
-- normalized SA ID / passport identity. Minor rows without an identity remain
-- excluded from the unique index.
--
-- If this migration fails with duplicate_patient_identity_existing_rows, merge
-- or otherwise remediate the duplicate patient rows before re-running it; do
-- not drop/loosen the constraint.

do $$
begin
  if exists (
    select 1
    from (
      select
        id_type,
        case when id_type = 'passport' then upper(coalesce(id_country, '')) else '' end as normalized_country,
        upper(btrim(id_number)) as normalized_id_number,
        count(*)
      from public.patients
      where id_type <> 'none_minor'
        and coalesce(btrim(id_number), '') <> ''
      group by 1, 2, 3
      having count(*) > 1
    ) duplicates
  ) then
    raise exception 'duplicate_patient_identity_existing_rows'
      using errcode = '23505',
            detail = 'Run supabase/remediation/duplicate_patient_identity_cleanup.sql to inspect/remediate duplicate patient identities before applying patients_unique_identity_idx.';
  end if;
end $$;

create unique index if not exists patients_unique_identity_idx
  on public.patients (
    id_type,
    (case when id_type = 'passport' then upper(coalesce(id_country, '')) else '' end),
    upper(btrim(id_number))
  )
  where id_type <> 'none_minor'
    and coalesce(btrim(id_number), '') <> '';

comment on index public.patients_unique_identity_idx is
  'Prevents duplicate patient records for the same normalized SA ID/passport identity while allowing unidentified minor records.';
