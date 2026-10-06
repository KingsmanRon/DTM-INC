# Document backup and recovery

Supabase database backups contain Storage metadata, not the stored object bytes. Patient documents therefore need their own off-site copy, and a database restore alone is not a complete patient-record restore.

## Off-site document backup

Patient document objects are copied nightly to a private AWS S3 bucket in Cape Town (`af-south-1`) using the Glacier Instant Retrieval storage class. The Vercel cron `/api/v1/internal/backup-documents` runs at 01:00 UTC (03:00 SAST) with `CRON_SECRET`, copies objects not yet in the bucket within `BACKUP_TIME_BUDGET_SECONDS` (default 45, at most 50 inside the route's 60-second `maxDuration`) and reports how many remain.

- Each object is re-hashed against `patient_documents.sha256_hash` before upload; a mismatch or missing source is recorded, not copied, and makes the cron return 500.
- Uploads are conditional (`If-None-Match: *`) and carry a SHA-256 checksum that S3 verifies. Storage keys are unique per upload, so an existing object is never replaced.
- `patient_document_backups` (migration `0058`, service role only) records the outcome per object and is the reconciliation ledger. Failed objects are retried on the next five runs.
- Compression originals (`original_storage_key`) are included; archived objects whose bytes were deliberately removed (`storage_object_deleted_at`) are skipped.

Vercel environment (Production): `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION` (`af-south-1`), `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` (Sensitive). Until they are set the job returns 503 `backup_not_configured` and copies nothing. The bucket must have versioning on and public access blocked. The backup IAM user gets only:

```json
{
  "Version": "2012-10-17",
  "Statement": [{ "Sid": "AddOnlyBackups", "Effect": "Allow", "Action": "s3:PutObject",
                  "Resource": "arn:aws:s3:::BUCKET/patient-documents/*" }]
}
```

That key cannot read, list, overwrite or delete backups. Restore access uses a separate read-only IAM user created only for drills and restores, never stored in Vercel.

The bucket lives in a dedicated "DTM Backups" member account of the developer's AWS Organization, separate from other practices. The Organization's root-attached SCP `AdvancedModeRegionRestrictionSecurityControlPolicy` must keep `af-south-1` in its `RegionFloor` list; if it is reset, every upload fails with `s3_put_failed: HTTP 403 AccessDenied`.

### First backlog

The nightly run is time-boxed, so clear the existing documents once from an operator machine with the same job and no time limit:

```sh
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
BACKUP_S3_BUCKET=... BACKUP_S3_REGION=af-south-1 \
BACKUP_S3_ACCESS_KEY_ID=... BACKUP_S3_SECRET_ACCESS_KEY=... \
npm run docs:backup
```

Use a temporary second access key on the backup IAM user and delete it afterwards. The command prints counts only. Run it again after an outage to catch up.

### Monitoring

```sql
select
  (select count(*) from public.patient_documents)                                    as documents,
  (select count(*) from public.patient_document_backups where status = 'backed_up')  as backed_up,
  (select count(*) from public.patient_document_backups where status <> 'backed_up') as problems,
  public.documents_pending_backup_count()                                             as remaining;
select status, last_error, count(*) from public.patient_document_backups group by 1, 2;
```

## Restore drill

1. Export the inventory as the migration owner to an encrypted operations location, never Git: `select json_agg(json_build_object('storage_key', storage_key, 'sha256_hash', sha256_hash, 'file_size', file_size, 'mime_type', mime_type)) from public.patient_documents where storage_object_deleted_at is null;`
2. With the read-only restore user: `aws s3 sync s3://BUCKET/patient-documents/ ./restore/ --region af-south-1`. Glacier Instant Retrieval objects download immediately.
3. `node scripts/verify-document-backup.mjs --manifest inventory.json --root ./restore` must report every row MATCH. It does no network access, outputs row numbers and status only, and keeps reads inside the backup root.
4. Record the date, duration, counts and operator; securely delete the local copy afterwards.

Encrypted clinical notes also need the Vault KEK. Supabase database backups keep it only within the same project, so the practice owner keeps an offline escrow copy in an access-controlled password manager, separate from AWS; it is never stored in the backup bucket, Git, chat or logs.
