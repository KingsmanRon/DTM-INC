#!/usr/bin/env -S npx tsx
//
// Original-cleanup for compressed patient documents (spec §9). SEPARATE from the
// compression run — never invoked by it.
//
// DEFAULT ACTION IS ARCHIVE, NOT DELETE. For a medical record the faithful
// original is the record of value and SA retention windows run in years, so the
// default cold-archives the original (moves it to archive/originals/...,
// retrievable) and repoints original_storage_key so rollback still works. This
// captures most of the storage benefit without destroying the record.
//
// HARD-DELETE is a distinct, deliberately-flagged path with extra guards. It is
// irreversible and may conflict with SA records-retention obligations.
//
// USAGE
//   # cold-archive originals of compressed docs (DEFAULT, dry-run unless --apply)
//   npx tsx scripts/cleanup_patient_document_originals.ts --apply
//   # hard-delete (all guards must pass):
//   npx tsx scripts/cleanup_patient_document_originals.ts --apply \
//     --hard-delete --i-understand-this-is-irreversible \
//     --verification-confirmed --operator "Dr X" [--retention-days 30]
//
// FLAGS  --apply  --retention-days N(=30, min 14)  --limit N
//        --patient-id ID  --document-id ID
//        --hard-delete --i-understand-this-is-irreversible
//        --verification-confirmed  --operator NAME
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BUCKET,
  DOCUMENT_ROW_COLUMNS,
  type DocumentRow,
  decodesAsValidImage,
  fmtBytes,
  getAdminClient,
  objectExists,
} from "./lib/patient-doc-compression";

const ARCHIVE_PREFIX = "archive/originals";
const DEFAULT_RETENTION_DAYS = 30;
const MIN_RETENTION_DAYS = 14;

type Args = {
  apply: boolean;
  hardDelete: boolean;
  irreversibleAck: boolean;
  verificationConfirmed: boolean;
  operator: string | null;
  retentionDays: number;
  limit: number | null;
  patientId: string | null;
  documentId: string | null;
};

function parseArgs(argv: string[]): Args {
  const a: Args = {
    apply: false, hardDelete: false, irreversibleAck: false, verificationConfirmed: false,
    operator: null, retentionDays: DEFAULT_RETENTION_DAYS, limit: null, patientId: null, documentId: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case "--apply": a.apply = true; break;
      case "--dry-run": a.apply = false; break;
      case "--hard-delete": a.hardDelete = true; break;
      case "--i-understand-this-is-irreversible": a.irreversibleAck = true; break;
      case "--verification-confirmed": a.verificationConfirmed = true; break;
      case "--operator": a.operator = next(); break;
      case "--retention-days": a.retentionDays = Number(next()); break;
      case "--limit": a.limit = Number(next()); break;
      case "--patient-id": a.patientId = next(); break;
      case "--document-id": a.documentId = next(); break;
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (a.retentionDays < MIN_RETENTION_DAYS) {
    throw new Error(`--retention-days must be >= ${MIN_RETENTION_DAYS} (got ${a.retentionDays})`);
  }
  return a;
}

async function selectCompressed(client: SupabaseClient, args: Args): Promise<DocumentRow[]> {
  let q = client
    .from("patient_documents")
    .select(DOCUMENT_ROW_COLUMNS)
    .eq("compression_status", "compressed")
    .not("original_storage_key", "is", null)
    .order("compressed_at", { ascending: true });
  if (args.patientId) q = q.eq("patient_id", args.patientId);
  if (args.documentId) q = q.eq("id", args.documentId);
  if (args.limit) q = q.limit(args.limit);
  const { data, error } = await q;
  if (error) throw new Error(`query failed: ${error.message}`);
  return (data ?? []) as unknown as DocumentRow[];
}

// Move the original to a cold-archive path and repoint original_storage_key so
// rollback still resolves. Supabase storage move = server-side rename.
async function archiveOriginal(client: SupabaseClient, row: DocumentRow, log: (s: string) => void) {
  const from = row.original_storage_key!;
  if (from.startsWith(`${ARCHIVE_PREFIX}/`)) {
    log(`[skip] doc=${row.id} — already archived at ${from}`);
    return "skipped";
  }
  if (!(await objectExists(client, from))) {
    log(`[skip] doc=${row.id} — original missing at ${from}`);
    return "missing";
  }
  const to = `${ARCHIVE_PREFIX}/${from}`;
  const { error: mvErr } = await client.storage.from(BUCKET).move(from, to);
  if (mvErr) throw new Error(`archive move failed for ${row.id}: ${mvErr.message}`);
  // Repoint so rollback continues to find the original at its new home.
  const { error: updErr } = await client
    .from("patient_documents")
    .update({ original_storage_key: to })
    .eq("id", row.id)
    .eq("storage_key", row.storage_key); // guard: don't touch a row that changed
  if (updErr) throw new Error(`archive pointer update failed for ${row.id}: ${updErr.message}`);
  log(`[archived] doc=${row.id} ${from} -> ${to}`);
  return "archived";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = getAdminClient();
  // eslint-disable-next-line no-console
  const log = console.log;

  const mode = args.hardDelete ? "HARD-DELETE" : "ARCHIVE";
  log(`cleanup_patient_document_originals — action=${mode} ${args.apply ? "APPLY" : "DRY-RUN"}`);

  if (args.hardDelete) {
    log("\n!!!  RECORDS-RETENTION WARNING  !!!");
    log("Hard-deleting the only faithful original of a medical document may conflict with");
    log("South African records-retention obligations. The DEFAULT and recommended action is");
    log("ARCHIVE. Proceed only with documented operator sign-off.\n");
    if (!args.irreversibleAck) {
      throw new Error("--hard-delete requires --i-understand-this-is-irreversible");
    }
    if (!args.verificationConfirmed) {
      throw new Error("--hard-delete requires --verification-confirmed (frontend verification recorded as complete, spec §9)");
    }
    if (!args.operator) {
      throw new Error("--hard-delete requires --operator NAME for the sign-off record");
    }
    log(`operator sign-off: ${args.operator}; retention window: ${args.retentionDays} days\n`);
  }

  const rows = await selectCompressed(client, args);
  log(`compressed rows in scope: ${rows.length}\n`);

  const cutoff = Date.now() - args.retentionDays * 24 * 60 * 60 * 1000;
  let archived = 0, deleted = 0, skipped = 0, blocked = 0;

  for (const row of rows) {
    if (!args.hardDelete) {
      // ── ARCHIVE (default) ────────────────────────────────────────────────
      if (!args.apply) {
        skipped++;
        log(`[would-archive] doc=${row.id} original=${row.original_storage_key} ` +
          `(${fmtBytes(row.original_file_size ?? 0)})`);
        continue;
      }
      const r = await archiveOriginal(client, row, log);
      if (r === "archived") archived++; else skipped++;
      continue;
    }

    // ── HARD-DELETE (guarded) ──────────────────────────────────────────────
    // Guard a: terminal compressed (already filtered). Guard b: retention age.
    const compressedAt = row.compressed_at ? Date.parse(row.compressed_at) : NaN;
    if (!Number.isFinite(compressedAt) || compressedAt > cutoff) {
      blocked++;
      log(`[blocked] doc=${row.id} — inside ${args.retentionDays}d retention window ` +
        `(compressed_at=${row.compressed_at})`);
      continue;
    }
    // Guard c: the compressed object currently verifies (re-fetch + decode).
    const verifies = await decodesAsValidImage(client, row.storage_key);
    if (!verifies.ok) {
      blocked++;
      log(`[blocked] doc=${row.id} — compressed object does not verify: ${verifies.reason}`);
      continue;
    }
    if (!row.original_storage_key) { blocked++; continue; }
    if (!(await objectExists(client, row.original_storage_key))) {
      skipped++;
      log(`[skip] doc=${row.id} — original already absent at ${row.original_storage_key}`);
      continue;
    }

    if (!args.apply) {
      skipped++;
      log(`[would-hard-delete] doc=${row.id} original=${row.original_storage_key} ` +
        `(${fmtBytes(row.original_file_size ?? 0)}) — all guards pass`);
      continue;
    }
    const { error: delErr } = await client.storage.from(BUCKET).remove([row.original_storage_key]);
    if (delErr) throw new Error(`hard-delete failed for ${row.id}: ${delErr.message}`);
    deleted++;
    log(`[hard-deleted-original] doc=${row.id} ${row.original_storage_key} ` +
      `(operator=${args.operator})`);
  }

  log("\n── summary ───────────────────────────────────────────────");
  if (args.hardDelete) {
    log(`  originals ${args.apply ? "hard-deleted" : "eligible"}: ${args.apply ? deleted : skipped}`);
    log(`  blocked by guards: ${blocked}`);
  } else {
    log(`  originals ${args.apply ? "archived" : "to archive"}: ${args.apply ? archived : skipped}`);
  }
  log("  (orphan storage objects are out of scope, spec §12)");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`fatal: ${(err as Error).message}`);
  process.exit(1);
});
