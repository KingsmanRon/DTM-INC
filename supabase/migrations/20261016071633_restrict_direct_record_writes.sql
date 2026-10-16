-- Apply only after the new application is serving requests (see rollout).
-- Do not alter service_role grants: compression, cleanup and backup jobs need
-- their existing narrowly reviewed access. No historical audit data is touched.
begin;
revoke insert, update, delete on public.patients, public.patient_documents from public, anon, authenticated;
-- Remove any legacy column grants as well: table-level REVOKE alone does not
-- remove an independently granted column privilege.
do $$
declare t text; cols text;
begin
  foreach t in array array['patients','patient_documents'] loop
    select string_agg(quote_ident(attname), ', ') into cols from pg_attribute
     where attrelid=format('public.%I',t)::regclass and attnum>0 and not attisdropped;
    execute format('revoke insert (%s), update (%s) on public.%I from public, anon, authenticated',cols,cols,t);
  end loop;
end;
$$;
drop policy if exists patients_clinical_write on public.patients;
drop policy if exists patients_clinical_update on public.patients;
drop policy if exists patient_documents_clinical_insert on public.patient_documents;
drop policy if exists patient_documents_clinical_update on public.patient_documents;
commit;
