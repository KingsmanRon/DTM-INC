// Nightly off-site backup of patient document objects.
//
// Supabase database backups hold document metadata, not the stored bytes, so
// each object in the private patient-documents bucket is copied to the S3
// backup target exactly once. Storage keys are unique per upload and the
// compression tooling always writes to a new key, so a key never changes
// content: an object that already exists in S3 is treated as backed up.
//
// Before copying, the bytes are re-hashed against patient_documents.sha256_hash
// so a corrupted source is reported instead of being preserved silently.
// patient_document_backups records every outcome; it is the evidence the
// restore drill reconciles against. Logs carry document ids only, never file
// names or storage keys (which can contain patient names).
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { backupObjectKey, putBackupObject, type BackupTarget } from "./s3";

const SOURCE_BUCKET = "patient-documents";
const LOCK_NAME = "document_backup";

export type PendingBackup = {
  document_id: string;
  storage_key: string;
  sha256_hash: string;
  mime_type: string | null;
  object_kind: "active" | "original";
  attempts: number;
};

export type BackupSummary = {
  acquired_lock: boolean;
  attempted: number;
  stored: number;
  already_present: number;
  missing_source: number;
  original_removed: number;
  hash_mismatch: number;
  failed: number;
  remaining: number | null;
  stopped_for_time: boolean;
};

export type BackupOptions = { timeBudgetMs: number; batchSize?: number; lockTtlSeconds?: number };
export type BackupDeps = { put?: typeof putBackupObject; now?: () => number };

type Outcome = "backed_up" | "already_present" | "missing_source" | "original_removed" | "hash_mismatch" | "failed";
type RecordedStatus = "backed_up" | "missing_source" | "original_removed" | "hash_mismatch" | "failed";

export function emptySummary(): BackupSummary {
  return { acquired_lock: false, attempted: 0, stored: 0, already_present: 0, missing_source: 0, original_removed: 0, hash_mismatch: 0, failed: 0, remaining: null, stopped_for_time: false };
}

async function record(
  admin: SupabaseClient,
  item: PendingBackup,
  status: RecordedStatus,
  extra: { s3Key?: string; versionId?: string | null; error?: string },
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin.from("patient_document_backups").upsert({
    storage_key: item.storage_key,
    document_id: item.document_id,
    object_kind: item.object_kind,
    sha256_hash: item.sha256_hash,
    status,
    s3_key: extra.s3Key ?? null,
    s3_version_id: extra.versionId ?? null,
    attempts: item.attempts + 1,
    last_error: extra.error ?? null,
    backed_up_at: status === "backed_up" ? now : null,
    updated_at: now,
  }, { onConflict: "storage_key" });
  if (error) console.error("[backup] could not record outcome", { document_id: item.document_id, status, error: error.message });
}

// true / false when Storage answers, null when the check itself fails.
async function sourceExists(admin: SupabaseClient, key: string): Promise<boolean | null> {
  try {
    const { data } = await admin.storage.from(SOURCE_BUCKET).exists(key);
    return typeof data === "boolean" ? data : null;
  } catch {
    return null;
  }
}

async function backupOne(admin: SupabaseClient, target: BackupTarget, item: PendingBackup, put: typeof putBackupObject): Promise<Outcome> {
  const { data, error } = await admin.storage.from(SOURCE_BUCKET).download(item.storage_key);
  if (error || !data) {
    // Tell a deleted object from a failed download. The originals clean-up's
    // hard-delete removes an original's bytes but keeps original_storage_key;
    // the compressed copy is the live record and is backed up as 'active'.
    const exists = await sourceExists(admin, item.storage_key);
    if (exists === false && item.object_kind === "original") {
      await record(admin, item, "original_removed", { error: "original_deleted_from_storage" });
      return "original_removed";
    }
    if (exists === false) {
      await record(admin, item, "missing_source", { error: "source_not_in_storage" });
      return "missing_source";
    }
    await record(admin, item, "failed", { error: "source_download_failed" });
    return "failed";
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== item.sha256_hash.toLowerCase()) {
    await record(admin, item, "hash_mismatch", { error: "source_hash_does_not_match_record" });
    return "hash_mismatch";
  }
  const key = backupObjectKey(target, item.storage_key);
  try {
    const result = await put(target, key, bytes, item.mime_type ?? "application/octet-stream");
    await record(admin, item, "backed_up", { s3Key: key, versionId: result.status === "stored" ? result.versionId : null });
    return result.status === "stored" ? "backed_up" : "already_present";
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 200) : "s3_put_failed";
    await record(admin, item, "failed", { s3Key: key, error: message });
    return "failed";
  }
}

export async function runDocumentBackup(
  admin: SupabaseClient,
  target: BackupTarget,
  options: BackupOptions,
  deps: BackupDeps = {},
): Promise<BackupSummary> {
  const put = deps.put ?? putBackupObject;
  const now = deps.now ?? Date.now;
  const deadline = now() + options.timeBudgetMs;
  const batchSize = options.batchSize ?? 50;
  const summary = emptySummary();

  const { data: acquired, error: lockErr } = await admin.rpc("try_acquire_maintenance_lock", {
    p_name: LOCK_NAME,
    p_ttl_seconds: options.lockTtlSeconds ?? Math.ceil(options.timeBudgetMs / 1000) + 120,
  });
  if (lockErr) {
    console.error("[backup] lock acquire failed", { error: lockErr.message });
    return summary;
  }
  if (acquired !== true) {
    console.warn("[backup] maintenance lease not acquired; nothing copied");
    return summary;
  }
  summary.acquired_lock = true;

  // Items retried in this run are skipped so a persistent failure cannot spin.
  const seen = new Set<string>();
  try {
    outer: while (now() < deadline) {
      const { data, error } = await admin.rpc("documents_pending_backup", { p_limit: batchSize + seen.size });
      if (error) {
        console.error("[backup] pending query failed", { error: error.message });
        summary.failed++;
        break;
      }
      const batch = ((data ?? []) as PendingBackup[]).filter((item) => !seen.has(item.storage_key));
      if (batch.length === 0) break;
      for (const item of batch) {
        if (now() >= deadline) { summary.stopped_for_time = true; break outer; }
        seen.add(item.storage_key);
        summary.attempted++;
        let outcome: Outcome;
        try {
          outcome = await backupOne(admin, target, item, put);
        } catch (err) {
          const message = (err instanceof Error ? err.message : String(err)).slice(0, 200);
          console.error("[backup] unexpected error", { document_id: item.document_id, error: message });
          await record(admin, item, "failed", { error: `unexpected: ${message}` });
          outcome = "failed";
        }
        if (outcome === "backed_up") summary.stored++;
        else summary[outcome]++;
        if (outcome !== "backed_up" && outcome !== "already_present" && outcome !== "original_removed") {
          console.error("[backup] document not backed up", { document_id: item.document_id, object_kind: item.object_kind, outcome });
        }
      }
    }
    if (now() >= deadline) summary.stopped_for_time = true;
  } finally {
    const { error: relErr } = await admin.rpc("release_maintenance_lock", { p_name: LOCK_NAME });
    if (relErr) console.error("[backup] lock release failed", { error: relErr.message });
  }

  const { data: remaining, error: countErr } = await admin.rpc("documents_pending_backup_count");
  summary.remaining = countErr ? null : Number(remaining ?? 0);
  return summary;
}
