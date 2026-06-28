#!/usr/bin/env -S npx tsx
//
// Safe, resumable backfill that compresses EXISTING patient-document images to
// WebP. These are POPIA / SA-retention medical records, not photos: correctness,
// legibility and non-destruction of originals outrank storage savings. Read the
// spec (and the design-decision block) before changing defaults.
//
// USAGE
//   # dry-run (DEFAULT — runs real sharp compression in memory, writes nothing):
//   npx tsx scripts/compress_patient_documents.ts
//   # canary (5-10 docs across categories) — gate the full run on human review:
//   npx tsx scripts/compress_patient_documents.ts --apply --canary
//   # full apply:
//   npx tsx scripts/compress_patient_documents.ts --apply
//
// FLAGS  --apply  --dry-run(default)  --limit N  --patient-id ID
//        --document-id ID  --min-size-mb N(=2)  --force  --canary
//
// Env (server-side only): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// The service-role key is never logged.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COMPRESSIBLE_IMAGE_MIME,
  DOCUMENT_ROW_COLUMNS,
  TEXT_CRITICAL_CATEGORIES,
  type DocumentRow,
  buildCompressedPath,
  compressDocumentImage,
  downloadObject,
  fmtBytes,
  getAdminClient,
  pct,
  sha256Hex,
  uploadCompressed,
  verifyRoundTrip,
} from "./lib/patient-doc-compression";

// Statuses a row may be in and still represent unfinished work.
const PROCESSABLE_STATUSES = ["pending", "failed", "in_progress", "uploaded", "verified"];
// Canary spread across categories (spec §7).
const CANARY_CATEGORIES = [
  "id_copy",
  "medical_aid_card",
  "referral_letter",
  "pathology_result",
  "correspondence",
];

type Args = {
  apply: boolean;
  limit: number | null;
  patientId: string | null;
  documentId: string | null;
  minSizeBytes: number;
  force: boolean;
  canary: boolean;
};

function parseArgs(argv: string[]): Args {
  const a: Args = {
    apply: false,
    limit: null,
    patientId: null,
    documentId: null,
    minSizeBytes: 2 * 1024 * 1024,
    force: false,
    canary: false,
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
      case "--force": a.force = true; break;
      case "--canary": a.canary = true; break;
      case "--limit": a.limit = Number(next()); break;
      case "--patient-id": a.patientId = next(); break;
      case "--document-id": a.documentId = next(); break;
      case "--min-size-mb": a.minSizeBytes = Math.round(Number(next()) * 1024 * 1024); break;
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  return a;
}

// Per-row decision the run will take.
type Action =
  | "would-compress"
  | "compressed"
  | "would-skip-too-small"
  | "skipped-too-small"
  | "would-skip-larger-result"
  | "skipped-larger-result"
  | "would-skip-unsupported"
  | "already-compressed"
  | "failed"
  | "locked-skip"
  | "row-changed-skip";

type Tally = Record<Action, number> & { storageDeletes: number; bytesBefore: number; bytesAfter: number };

function newTally(): Tally {
  return {
    "would-compress": 0, compressed: 0,
    "would-skip-too-small": 0, "skipped-too-small": 0,
    "would-skip-larger-result": 0, "skipped-larger-result": 0,
    "would-skip-unsupported": 0, "already-compressed": 0,
    failed: 0, "locked-skip": 0, "row-changed-skip": 0,
    storageDeletes: 0, bytesBefore: 0, bytesAfter: 0,
  };
}

function logRow(row: DocumentRow, action: Action, detail: string, ms?: number) {
  const t = ms === undefined ? "" : ` ${ms}ms`;
  const crit = TEXT_CRITICAL_CATEGORIES.has(row.category) ? " [text-critical]" : "";
  // eslint-disable-next-line no-console
  console.log(
    `[${action}] doc=${row.id} patient=${row.patient_id} cat=${row.category}${crit} ${detail}${t}`,
  );
}

// ── Candidate selection (active, non-archived, image rows with work to do) ───
async function selectCandidates(client: SupabaseClient, args: Args): Promise<DocumentRow[]> {
  if (args.canary) {
    const out: DocumentRow[] = [];
    for (const category of CANARY_CATEGORIES) {
      const { data, error } = await client
        .from("patient_documents")
        .select(DOCUMENT_ROW_COLUMNS)
        .is("archived_at", null)
        .in("mime_type", COMPRESSIBLE_IMAGE_MIME as string[])
        .in("compression_status", PROCESSABLE_STATUSES)
        .eq("category", category)
        .order("file_size", { ascending: false })
        .limit(2);
      if (error) throw new Error(`candidate query failed (${category}): ${error.message}`);
      out.push(...((data ?? []) as unknown as DocumentRow[]));
    }
    return out;
  }

  let q = client
    .from("patient_documents")
    .select(DOCUMENT_ROW_COLUMNS)
    .is("archived_at", null)
    .in("mime_type", COMPRESSIBLE_IMAGE_MIME as string[])
    .in("compression_status", PROCESSABLE_STATUSES)
    .order("file_size", { ascending: false });
  if (args.patientId) q = q.eq("patient_id", args.patientId);
  if (args.documentId) q = q.eq("id", args.documentId);
  if (args.limit) q = q.limit(args.limit);
  const { data, error } = await q;
  if (error) throw new Error(`candidate query failed: ${error.message}`);
  return (data ?? []) as unknown as DocumentRow[];
}

// ── DB helpers ───────────────────────────────────────────────────────────────
async function leaseRow(client: SupabaseClient, id: string): Promise<DocumentRow | null> {
  const { data, error } = await client.rpc("lease_patient_document_for_compression", { p_id: id });
  if (error) throw new Error(`lease failed for ${id}: ${error.message}`);
  const rows = (data ?? []) as unknown as DocumentRow[];
  return rows.length ? rows[0]! : null;
}

async function setStatus(
  client: SupabaseClient,
  id: string,
  status: string,
  error: string | null,
): Promise<void> {
  const { error: err } = await client
    .from("patient_documents")
    .update({ compression_status: status, compression_error: error })
    .eq("id", id);
  if (err) throw new Error(`status update (${status}) failed for ${id}: ${err.message}`);
}

async function swap(
  client: SupabaseClient,
  row: DocumentRow,
  compressedPath: string,
  originalHash: string,
  compressedSize: number,
  compressedHash: string,
  quality: number,
): Promise<number> {
  const { data, error } = await client.rpc("swap_patient_document_to_compressed", {
    p_id: row.id,
    p_expected_old_key: row.storage_key,
    p_original_hash: originalHash,
    p_original_mime: row.mime_type,
    p_compressed_path: compressedPath,
    p_compressed_size: compressedSize,
    p_compressed_hash: compressedHash,
    p_final_quality: quality,
  });
  if (error) throw new Error(`swap rpc failed for ${row.id}: ${error.message}`);
  return Number(data ?? 0);
}

async function currentStatus(client: SupabaseClient, id: string): Promise<string | null> {
  const { data, error } = await client
    .from("patient_documents")
    .select("compression_status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`status read failed for ${id}: ${error.message}`);
  return (data?.compression_status as string | undefined) ?? null;
}

// ── Per-document processing ──────────────────────────────────────────────────
async function processRow(client: SupabaseClient, input: DocumentRow, args: Args, tally: Tally) {
  const started = Date.now();

  // Unsupported mime (defensive — the query already filters these out).
  if (!COMPRESSIBLE_IMAGE_MIME.includes(input.mime_type)) {
    tally["would-skip-unsupported"]++;
    logRow(input, "would-skip-unsupported", `mime=${input.mime_type}`);
    return;
  }

  // Small-file skip (unless --force). Terminal 'skipped' so re-runs stay clean.
  if (input.file_size < args.minSizeBytes && !args.force) {
    if (args.apply) {
      const row = await leaseRow(client, input.id);
      if (!row) { tally["locked-skip"]++; logRow(input, "locked-skip", "lease contended"); return; }
      if (row.compression_status === "compressed") { tally["already-compressed"]++; return; }
      await setStatus(client, input.id, "skipped", "below_min_size");
      tally["skipped-too-small"]++;
      logRow(input, "skipped-too-small", `size=${fmtBytes(input.file_size)} < ${fmtBytes(args.minSizeBytes)}`);
    } else {
      tally["would-skip-too-small"]++;
      logRow(input, "would-skip-too-small", `size=${fmtBytes(input.file_size)} < ${fmtBytes(args.minSizeBytes)}`);
    }
    return;
  }

  // ── DRY-RUN: real compression in memory, no leasing, no writes ─────────────
  if (!args.apply) {
    const original = await downloadObject(client, input.storage_key);
    const outcome = await compressDocumentImage(original, input.category, original.length);
    if (outcome.kind === "skipped-larger") {
      tally["would-skip-larger-result"]++;
      logRow(input, "would-skip-larger-result",
        `old=${fmtBytes(original.length)} new=${fmtBytes(outcome.attemptedSize)}`, Date.now() - started);
      return;
    }
    tally["would-compress"]++;
    tally.bytesBefore += original.length;
    tally.bytesAfter += outcome.size;
    logRow(input, "would-compress",
      `old=${fmtBytes(original.length)} new=${fmtBytes(outcome.size)} ` +
      `saving=${pct(outcome.size, original.length)} tier=${outcome.tier} q=${outcome.quality}`,
      Date.now() - started);
    return;
  }

  // ── APPLY ──────────────────────────────────────────────────────────────────
  const row = await leaseRow(client, input.id);
  if (!row) { tally["locked-skip"]++; logRow(input, "locked-skip", "lease contended"); return; }
  if (row.compression_status === "compressed") {
    tally["already-compressed"]++; logRow(row, "already-compressed", "terminal"); return;
  }
  // Status moved to another terminal state (skipped / rolled_back) between the
  // candidate query and the lease — leave it alone.
  if (!PROCESSABLE_STATUSES.includes(row.compression_status)) {
    logRow(row, "already-compressed", `terminal (${row.compression_status})`);
    return;
  }

  try {
    // 1. Capture original fingerprints FIRST (spec §4 step 1).
    const original = await downloadObject(client, row.storage_key);
    const originalHash = sha256Hex(original);

    // 4. Compress per category policy.
    const outcome = await compressDocumentImage(original, row.category, original.length);
    if (outcome.kind === "skipped-larger") {
      await setStatus(client, row.id, "skipped", "compressed_larger_than_original");
      tally["skipped-larger-result"]++;
      logRow(row, "skipped-larger-result",
        `old=${fmtBytes(original.length)} new=${fmtBytes(outcome.attemptedSize)}`, Date.now() - started);
      return;
    }

    // 5. Upload to the NEW v1 path (never overwrite the original). upsert makes
    //    a resumed run idempotent on the same path.
    const compressedPath = buildCompressedPath(row.patient_id, row.id, row.original_filename);
    await uploadCompressed(client, compressedPath, outcome.buffer);
    await setStatus(client, row.id, "uploaded", null);

    // 6. Verify by round-trip (re-fetch + decode + hash). On any failure leave
    //    the original storage_key untouched.
    const verified = await verifyRoundTrip(client, compressedPath, outcome.sha256);
    if (!verified.ok) {
      await setStatus(client, row.id, "failed", `verify_failed: ${verified.reason}`);
      tally.failed++;
      logRow(row, "failed", `verify: ${verified.reason}`, Date.now() - started);
      return;
    }
    await setStatus(client, row.id, "verified", null);

    // 7. Atomic guarded swap. 0 rows == the row changed underneath us.
    const affected = await swap(
      client, row, compressedPath, originalHash, outcome.size, outcome.sha256, outcome.quality,
    );
    if (affected === 0) {
      const now = await currentStatus(client, row.id);
      if (now === "compressed") {
        tally["already-compressed"]++;
        logRow(row, "already-compressed", "swapped by concurrent worker");
        return;
      }
      // A live write changed the row. Do NOT clobber. Leave the compressed
      // object for later cleanup; mark failed so it is not ambiguous residue.
      await setStatus(client, row.id, "failed", "swap_no_op_row_changed");
      tally["row-changed-skip"]++;
      logRow(row, "row-changed-skip", "guarded swap matched 0 rows", Date.now() - started);
      return;
    }

    tally.compressed++;
    tally.bytesBefore += original.length;
    tally.bytesAfter += outcome.size;
    logRow(row, "compressed",
      `old=${fmtBytes(original.length)} new=${fmtBytes(outcome.size)} ` +
      `saving=${pct(outcome.size, original.length)} tier=${outcome.tier} q=${outcome.quality} ` +
      `dim=${outcome.width}x${outcome.height} -> ${compressedPath}`,
      Date.now() - started);
  } catch (err) {
    const msg = (err as Error).message;
    await setStatus(client, row.id, "failed", `error: ${msg}`).catch(() => {});
    tally.failed++;
    logRow(row, "failed", msg, Date.now() - started);
  }
}

// ── Reconciliation (spec §11) ────────────────────────────────────────────────
async function reconcile(client: SupabaseClient, before: { total: number; archived: number }) {
  const after = await snapshot(client);
  const { data: counts } = await client.rpc("patient_document_compression_status_counts");
  const { count: orphanCompressed } = await client
    .from("patient_documents")
    .select("id", { count: "exact", head: true })
    .eq("compression_status", "compressed")
    .is("original_storage_key", null);

  // eslint-disable-next-line no-console
  console.log("\n── reconciliation (spec §11) ─────────────────────────────");
  console.log(`§11.1 no rows lost: before=${before.total} after=${after.total} ` +
    `(${before.total === after.total ? "OK" : "MISMATCH"})`);
  console.log(`§11.5 archived rows untouched: before=${before.archived} after=${after.archived} ` +
    `(${before.archived === after.archived ? "OK" : "MISMATCH"})`);
  console.log(`§11.3 compressed rows with NULL original_storage_key: ${orphanCompressed ?? "?"} ` +
    `(${(orphanCompressed ?? 0) === 0 ? "OK" : "FAIL"})`);
  console.log("§11.6 status histogram (watch for in_progress/uploaded/verified residue):");
  for (const r of (counts ?? []) as { compression_status: string; n: number }[]) {
    console.log(`        ${r.compression_status.padEnd(12)} ${r.n}`);
  }
}

async function snapshot(client: SupabaseClient): Promise<{ total: number; archived: number }> {
  const { count: total } = await client
    .from("patient_documents").select("id", { count: "exact", head: true });
  const { count: archived } = await client
    .from("patient_documents").select("id", { count: "exact", head: true })
    .not("archived_at", "is", null);
  return { total: total ?? 0, archived: archived ?? 0 };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = getAdminClient();
  const tally = newTally();

  // eslint-disable-next-line no-console
  console.log(`compress_patient_documents — mode=${args.apply ? "APPLY" : "DRY-RUN"}` +
    `${args.canary ? " CANARY" : ""} minSize=${fmtBytes(args.minSizeBytes)}` +
    `${args.force ? " --force" : ""}`);

  const before = await snapshot(client);
  const candidates = await selectCandidates(client, args);
  console.log(`candidates: ${candidates.length}\n`);

  // Sequential by default — the lease + guarded swap make running multiple
  // copies of this process concurrently safe (spec §10), so horizontal scaling
  // is "launch more processes", not in-process threads.
  for (const row of candidates) {
    await processRow(client, row, args, tally);
  }

  // eslint-disable-next-line no-console
  console.log("\n── summary ───────────────────────────────────────────────");
  for (const [k, v] of Object.entries(tally)) {
    if (k === "bytesBefore" || k === "bytesAfter") continue;
    if (v) console.log(`  ${k}: ${v}`);
  }
  if (tally.bytesBefore) {
    console.log(`  bytes: ${fmtBytes(tally.bytesBefore)} -> ${fmtBytes(tally.bytesAfter)} ` +
      `(saving ${pct(tally.bytesAfter, tally.bytesBefore)})`);
  }
  // §11.2 — this backfill performs zero storage deletes; assert it.
  console.log(`  storage deletes performed: ${tally.storageDeletes} ` +
    `(${tally.storageDeletes === 0 ? "OK" : "FAIL"})`);

  if (args.apply) {
    await reconcile(client, before);
  }
  if (args.canary) {
    console.log("\nCANARY: open each compressed document in the frontend and confirm it " +
      "renders, is legible, and every digit/letter is unambiguous BEFORE the full run (spec §7).");
  }
}

main().catch((err) => {
  // Never let a service-role key reach logs — only the message is printed.
  // eslint-disable-next-line no-console
  console.error(`fatal: ${(err as Error).message}`);
  process.exit(1);
});
