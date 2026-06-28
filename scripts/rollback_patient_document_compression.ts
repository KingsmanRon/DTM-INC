#!/usr/bin/env -S npx tsx
//
// Roll back compressed patient documents to their originals (spec §8). Per row:
//   1. Confirm the ORIGINAL object still exists in storage before flipping back.
//   2. Guarded UPDATE reversing the swap (storage_key/file_size/mime/sha back to
//      original, status -> 'rolled_back').
//   3. NEVER delete the original. The compressed copy is kept for diagnosis
//      unless --delete-compressed is passed.
//
// USAGE
//   npx tsx scripts/rollback_patient_document_compression.ts            # dry-run
//   npx tsx scripts/rollback_patient_document_compression.ts --apply
//   ... --document-id ID | --patient-id ID | --limit N | --delete-compressed
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BUCKET,
  DOCUMENT_ROW_COLUMNS,
  type DocumentRow,
  fmtBytes,
  getAdminClient,
  objectExists,
} from "./lib/patient-doc-compression";

type Args = {
  apply: boolean;
  patientId: string | null;
  documentId: string | null;
  limit: number | null;
  deleteCompressed: boolean;
};

function parseArgs(argv: string[]): Args {
  const a: Args = { apply: false, patientId: null, documentId: null, limit: null, deleteCompressed: false };
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
      case "--delete-compressed": a.deleteCompressed = true; break;
      case "--patient-id": a.patientId = next(); break;
      case "--document-id": a.documentId = next(); break;
      case "--limit": a.limit = Number(next()); break;
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  return a;
}

async function selectCompressed(client: SupabaseClient, args: Args): Promise<DocumentRow[]> {
  let q = client
    .from("patient_documents")
    .select(DOCUMENT_ROW_COLUMNS)
    .eq("compression_status", "compressed")
    .order("compressed_at", { ascending: false });
  if (args.patientId) q = q.eq("patient_id", args.patientId);
  if (args.documentId) q = q.eq("id", args.documentId);
  if (args.limit) q = q.limit(args.limit);
  const { data, error } = await q;
  if (error) throw new Error(`query failed: ${error.message}`);
  return (data ?? []) as unknown as DocumentRow[];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = getAdminClient();
  // eslint-disable-next-line no-console
  const log = console.log;

  log(`rollback_patient_document_compression — mode=${args.apply ? "APPLY" : "DRY-RUN"}` +
    `${args.deleteCompressed ? " --delete-compressed" : ""}`);

  const rows = await selectCompressed(client, args);
  log(`compressed rows in scope: ${rows.length}\n`);

  let restored = 0, skipped = 0, missingOriginal = 0, noop = 0, deleted = 0;

  for (const row of rows) {
    if (!row.original_storage_key) {
      // Should never happen for a 'compressed' row (acceptance §11.3), but never
      // flip a row we cannot restore.
      missingOriginal++;
      log(`[skip] doc=${row.id} — no original_storage_key recorded`);
      continue;
    }

    // 1. Confirm the original still exists before flipping back.
    const exists = await objectExists(client, row.original_storage_key);
    if (!exists) {
      missingOriginal++;
      log(`[skip] doc=${row.id} — original object missing at ${row.original_storage_key}`);
      continue;
    }

    if (!args.apply) {
      skipped++;
      log(`[would-rollback] doc=${row.id} patient=${row.patient_id} cat=${row.category} ` +
        `compressed=${fmtBytes(row.file_size)} -> original=${fmtBytes(row.original_file_size ?? 0)} ` +
        `(${row.mime_type} -> ${row.original_mime_type})`);
      continue;
    }

    // 2. Guarded reversal. expected compressed key = current storage_key.
    const compressedKey = row.storage_key;
    const { data, error } = await client.rpc("rollback_patient_document_compression", {
      p_id: row.id,
      p_expected_compressed_key: compressedKey,
    });
    if (error) throw new Error(`rollback rpc failed for ${row.id}: ${error.message}`);
    if (Number(data ?? 0) === 0) {
      noop++;
      log(`[noop] doc=${row.id} — row changed underneath (guarded update matched 0)`);
      continue;
    }
    restored++;
    log(`[rolled-back] doc=${row.id} patient=${row.patient_id} restored ${row.original_storage_key}`);

    // 3. Optionally delete the compressed copy (default: KEEP for diagnosis).
    //    The ORIGINAL is never deleted here.
    if (args.deleteCompressed) {
      const { error: delErr } = await client.storage.from(BUCKET).remove([compressedKey]);
      if (delErr) {
        log(`[warn] doc=${row.id} — failed to delete compressed copy ${compressedKey}: ${delErr.message}`);
      } else {
        deleted++;
        log(`[deleted-compressed] doc=${row.id} ${compressedKey}`);
      }
    }
  }

  log("\n── summary ───────────────────────────────────────────────");
  log(`  ${args.apply ? "rolled back" : "would roll back"}: ${args.apply ? restored : skipped}`);
  if (missingOriginal) log(`  skipped (original missing / unrecorded): ${missingOriginal}`);
  if (noop) log(`  noop (row changed): ${noop}`);
  if (args.deleteCompressed) log(`  compressed copies deleted: ${deleted}`);
  log("  original objects deleted: 0 (rollback NEVER deletes originals)");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`fatal: ${(err as Error).message}`);
  process.exit(1);
});
