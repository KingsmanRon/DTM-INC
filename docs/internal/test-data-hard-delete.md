# Hard delete dummy patient data (Supabase SQL)

`Supersedes 2026-04-29` means this guidance replaces the previous same-day note.

## Use case
Only for removing dummy/E2E data in non-production environments.

## 1) Apply migration
Ensure `0011_hard_delete_patient_tooling.sql` is applied.

## 2) Execute hard delete
```sql
select public.hard_delete_patient_data('<PATIENT_UUID>'::uuid);
```

## 3) Verify
```sql
select id, status, archived_at from patients where id = '<PATIENT_UUID>'::uuid;
```

## Notes
- This is irreversible.
- Audit logs are intentionally retained and are not deleted.
- Patient documents in Supabase Storage buckets are not automatically removed by this SQL function; remove blobs separately if required.
