// Manual / first-run document backup to the S3 target. Same logic as the
// nightly job (src/lib/backup/documents.ts) without the serverless time limit,
// for clearing the initial backlog or catching up after an outage.
//
//   npm run docs:backup
//
// Env (server-side only): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY,
// optional BACKUP_S3_REGION (default af-south-1). Output has counts only.
import { getAdminClient } from "./lib/patient-doc-compression";
import { backupTargetFromEnv } from "../src/lib/backup/s3";
import { runDocumentBackup } from "../src/lib/backup/documents";

async function main() {
  const target = backupTargetFromEnv();
  if (!target) throw new Error("Set BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY");
  const admin = getAdminClient();
  let problems = 0;
  for (let round = 1; ; round++) {
    const s = await runDocumentBackup(admin, target, { timeBudgetMs: 10 * 60_000 });
    if (!s.acquired_lock) throw new Error("Another backup run holds the lock; try again later");
    problems += s.missing_source + s.hash_mismatch + s.failed;
    console.log(`round ${round}: attempted=${s.attempted} stored=${s.stored} already_present=${s.already_present} ` +
      `missing_source=${s.missing_source} hash_mismatch=${s.hash_mismatch} failed=${s.failed} remaining=${s.remaining ?? "?"}`);
    if (!s.stopped_for_time || s.attempted === 0) break;
  }
  if (problems > 0) {
    console.error(`${problems} document(s) not backed up; see patient_document_backups for status per document`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
