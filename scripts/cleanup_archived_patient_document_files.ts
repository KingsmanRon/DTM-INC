#!/usr/bin/env -S npx tsx
//
// Safe cleanup for archived patient document storage objects.
//
// This script deletes only Supabase Storage objects for rows that are already
// archived in public.patient_documents. It never deletes database rows, never
// clears storage_key, never touches active documents, never targets compressed
// WebP replacement paths specifically, and does not attempt orphan cleanup.
//
// Usage:
//   npx tsx scripts/cleanup_archived_patient_document_files.ts              # dry-run
//   npx tsx scripts/cleanup_archived_patient_document_files.ts --apply \
//     --operator "Dr X" [--limit N] [--document-id ID]
import type { SupabaseClient } from "@supabase/supabase-js";
import { BUCKET, getAdminClient, objectExists } from "./lib/patient-doc-compression";

const DELETE_REASON = "archived_document_cleanup";

function isCompressedWebpKey(key: string): boolean {
  return key.toLowerCase().endsWith(".webp") || key.includes("/compressed/");
}

type Args = {
  apply: boolean;
  operator: string | null;
  limit: number | null;
  documentId: string | null;
};

type ArchivedDocumentRow = {
  id: string;
  patient_id: string;
  storage_key: string;
  archived_at: string;
  storage_object_deleted_at: string | null;
};

type CleanupResult = "would-delete" | "deleted" | "missing" | "blocked";

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer (got ${value})`);
  }
  return parsed;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, operator: null, limit: null, documentId: null };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      return value;
    };

    switch (arg) {
      case "--apply":
        args.apply = true;
        break;
      case "--dry-run":
        args.apply = false;
        break;
      case "--operator":
        args.operator = next().trim();
        break;
      case "--limit":
        args.limit = parsePositiveInt(next(), "--limit");
        break;
      case "--document-id":
        args.documentId = next().trim();
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (args.apply && !args.operator) {
    throw new Error("--operator NAME is required when --apply is used");
  }
  if (args.documentId === "") throw new Error("--document-id cannot be empty");

  return args;
}

async function selectArchivedRows(
  client: SupabaseClient,
  args: Args,
): Promise<ArchivedDocumentRow[]> {
  let query = client
    .from("patient_documents")
    .select("id, patient_id, storage_key, archived_at, storage_object_deleted_at")
    .not("archived_at", "is", null)
    .is("storage_object_deleted_at", null)
    .not("storage_key", "is", null)
    .order("archived_at", { ascending: true });

  if (args.documentId) query = query.eq("id", args.documentId);
  if (args.limit) query = query.limit(args.limit);

  const { data, error } = await query;
  if (error) throw new Error(`query failed: ${error.message}`);
  return (data ?? []) as unknown as ArchivedDocumentRow[];
}

async function markDeleted(
  client: SupabaseClient,
  row: ArchivedDocumentRow,
  operator: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("patient_documents")
    .update({
      storage_object_deleted_at: new Date().toISOString(),
      storage_object_deleted_by: operator,
      storage_object_delete_reason: DELETE_REASON,
    })
    .eq("id", row.id)
    .eq("storage_key", row.storage_key)
    .not("archived_at", "is", null)
    .is("storage_object_deleted_at", null)
    .select("id");

  if (error) throw new Error(`failed to mark row ${row.id}: ${error.message}`);
  return (data ?? []).length === 1;
}

async function cleanupRow(
  client: SupabaseClient,
  row: ArchivedDocumentRow,
  args: Args,
  log: (message: string) => void,
): Promise<CleanupResult> {
  if (isCompressedWebpKey(row.storage_key)) {
    log(`[blocked] doc=${row.id} storage_key=${row.storage_key} compressed_webp_out_of_scope`);
    return "blocked";
  }

  const exists = await objectExists(client, row.storage_key);
  if (!exists) {
    log(`[missing/skipped] doc=${row.id} storage_key=${row.storage_key}`);
    return "missing";
  }

  if (!args.apply) {
    log(`[would-delete-archived-object] doc=${row.id} storage_key=${row.storage_key}`);
    return "would-delete";
  }

  const { error: removeError } = await client.storage.from(BUCKET).remove([row.storage_key]);
  if (removeError) {
    log(`[blocked] doc=${row.id} storage_key=${row.storage_key} remove_failed=${removeError.message}`);
    return "blocked";
  }

  const marked = await markDeleted(client, row, args.operator!);
  if (!marked) {
    log(`[blocked] doc=${row.id} storage_key=${row.storage_key} row_changed_before_marking`);
    return "blocked";
  }

  log(`[deleted-archived-object] doc=${row.id} storage_key=${row.storage_key} operator=${args.operator}`);
  return "deleted";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = getAdminClient();
  // eslint-disable-next-line no-console
  const log = console.log;

  log(`cleanup_archived_patient_document_files — ${args.apply ? "APPLY" : "DRY-RUN"}`);
  log("scope: archived patient_documents rows only; DB rows and storage_key values are retained");
  log("out of scope: active documents, compressed WebP files, and orphan storage objects\n");

  const rows = await selectArchivedRows(client, args);
  let wouldDelete = 0;
  let deleted = 0;
  let missingSkipped = 0;
  let blocked = 0;

  for (const row of rows) {
    const result = await cleanupRow(client, row, args, log);
    if (result === "would-delete") wouldDelete++;
    if (result === "deleted") deleted++;
    if (result === "missing") missingSkipped++;
    if (result === "blocked") blocked++;
  }

  log("\n── summary ───────────────────────────────────────────────");
  log(`  archived objects in scope: ${rows.length}`);
  log(`  deleted: ${deleted}`);
  if (!args.apply) log(`  would delete: ${wouldDelete}`);
  log(`  missing/skipped: ${missingSkipped}`);
  log(`  blocked: ${blocked}`);
  log("  patient_documents rows were not deleted; storage_key values were not cleared");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`fatal: ${(err as Error).message}`);
  process.exit(1);
});
