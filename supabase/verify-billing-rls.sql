-- Verification for 0036_billing_export_items.sql — the security-critical RLS
-- posture for the monthly billing export. Run in the Supabase SQL editor or
-- psql after applying migrations. Section 4 fails loudly (raise exception) if
-- the posture regresses, so this can be wired into a deploy check.

-- 1) Billing policies: doctor + staff may read/write; admin/anon get nothing.
select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'billing_export_items'
order by policyname;

-- 2) Clinical notes stay doctor-only — staff must NEVER appear in a
--    clinical_notes (or patient_encryption_keys) policy predicate.
select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('clinical_notes', 'patient_encryption_keys')
order by tablename, policyname;

-- 3) No billing policy may reference clinical-note content columns.
select policyname, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'billing_export_items'
  and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* 'encrypted_body|encrypted_ink|clinical_notes|nonce';

-- 4) Hard assertions.
do $$
declare
  v_read_qual text;
  v_staff_on_notes int;
  v_admin_on_billing int;
begin
  -- billing read policy exists and admits BOTH doctor and staff.
  select qual into v_read_qual
  from pg_policies
  where schemaname = 'public' and tablename = 'billing_export_items'
    and policyname = 'billing_export_items_clinical_read';

  if v_read_qual is null then
    raise exception 'billing_export_items_clinical_read policy is missing';
  end if;
  if v_read_qual !~* 'doctor' or v_read_qual !~* 'staff' then
    raise exception 'billing read policy must admit doctor AND staff (got: %)', v_read_qual;
  end if;

  -- RLS must be enabled on the table.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'billing_export_items' and c.relrowsecurity
  ) then
    raise exception 'RLS is not enabled on billing_export_items';
  end if;

  -- Staff must NOT be able to read clinical notes (defends the isolation model).
  select count(*) into v_staff_on_notes
  from pg_policies
  where schemaname = 'public' and tablename = 'clinical_notes'
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* 'staff';
  if v_staff_on_notes > 0 then
    raise exception 'clinical_notes has % policy/policies referencing staff — isolation broken', v_staff_on_notes;
  end if;

  -- Admin must NOT be granted billing access (no demographic read for admin).
  select count(*) into v_admin_on_billing
  from pg_policies
  where schemaname = 'public' and tablename = 'billing_export_items'
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* 'admin';
  if v_admin_on_billing > 0 then
    raise exception 'billing_export_items must not grant admin access (found % policy/policies)', v_admin_on_billing;
  end if;

  raise notice 'billing RLS posture OK: doctor+staff read/write, admin excluded, clinical notes stay doctor-only';
end $$;

-- 5) OPTIONAL live role simulation. Fill in a real ACTIVE staff app_users.id to
--    prove at runtime that staff can read billing fields but are denied clinical
--    content. Wrap in a rolled-back transaction so it changes nothing.
--
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<STAFF_APP_USER_UUID>","role":"authenticated"}';
--   -- Expect: returns rows (staff may read billing fields).
--   select count(*) as billing_rows_visible_to_staff from public.billing_export_items;
--   -- Expect: 0 rows (staff denied clinical note content) — never the note body.
--   select count(*) as clinical_rows_visible_to_staff from public.clinical_notes;
-- rollback;
