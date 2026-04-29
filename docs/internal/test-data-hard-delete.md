# Hard delete dummy patient data (Supabase SQL)

`Supersedes 2026-04-29` means this guidance replaces the previous same-day note.

## Use case
Only for removing dummy/E2E data in non-production environments.

## 1) Apply migration
Ensure `0011_hard_delete_patient_tooling.sql` is applied.

## 2) Confirm the correct patient UUID first
Use one of these lookups before deleting anything.

By file number:
```sql
select id, file_number, first_names, surname, id_number, status, created_at
from patients
where file_number = '<FILE_NUMBER>';
```

By name/ID number:
```sql
select id, file_number, first_names, surname, id_number, status, created_at
from patients
where (first_names ilike '%<FIRST_NAME>%'
   and surname ilike '%<SURNAME>%')
   or id_number = '<ID_NUMBER>'
order by created_at desc;
```

## 3) Preview linked data counts (safety check)
```sql
select
  (select count(*) from clinical_notes where patient_id = '<PATIENT_UUID>'::uuid) as clinical_notes,
  (select count(*) from patient_documents where patient_id = '<PATIENT_UUID>'::uuid) as patient_documents,
  (select count(*) from consent_records where patient_id = '<PATIENT_UUID>'::uuid) as consent_records,
  (select count(*) from break_glass_requests where target_patient_id = '<PATIENT_UUID>'::uuid) as break_glass_requests;
```

## 4) Execute hard delete
```sql
select public.hard_delete_patient_data('<PATIENT_UUID>'::uuid);
```

## 5) Verify deletion
```sql
select id, status, archived_at from patients where id = '<PATIENT_UUID>'::uuid;
```

## Notes
- This is irreversible.
- Audit logs are intentionally retained and are not deleted.
- Patient documents in Supabase Storage buckets are not automatically removed by this SQL function; remove blobs separately if required.
