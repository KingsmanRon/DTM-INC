// Append-only, hash-chained audit log (§10.5, §FR-11).
//
// Design:
//   1. Each entry's `entry_hash = sha256(prev_hash || "|" || canonical_json(row_minus_hash))`.
//   2. Insert is delegated to the SECURITY DEFINER DB function
//      `write_audit_entry_atomic`, which takes a tx-scoped advisory lock, reads
//      the current tail, computes the next entry hash, and inserts in the same
//      database transaction. This keeps each application audit write to one RPC
//      instead of an app-side tail read followed by a second RPC.
//   3. The function is owned by `audit_writer` and executes only through
//      service_role from server-side code; the browser never receives the
//      service key.
//   4. A daily verifier walks the chain and alerts on breaks
//      (scripts/verify-audit-chain.mjs).
import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { logSupabaseCall } from "@/lib/supabase/log";
import type { AppRole } from "@/lib/auth/session";

export type AuditAction =
  | "login_success" | "login_failure" | "login_lockout" | "logout"
  | "patient_view" | "patient_create" | "patient_update" | "patient_archive" | "patient_unarchive"
  | "patient_file_reassigned"
  | "document_upload" | "document_view" | "document_download" | "document_archive" | "document_rename"
  | "note_create" | "note_read" | "note_amend" | "note_finalise" | "clinical_note_voided"
  | "user_create" | "user_deactivate" | "user_reset_mfa" | "permission_change"
  | "practice_settings_update" | "onboarding_pdf_generate"
  | "break_glass_request" | "break_glass_access"
  | "consent_capture" | "access_denied"
  | "billing_export_generate" | "billing_export_item_update" | "billing_export_mark_returned";

export type AuditInput = {
  actorUserId: string | null;
  actorRole: AppRole | null;
  action: AuditAction;
  entityType?: string | null;
  entityId?: string | null;
  patientId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  // When the audited action actually happened. Stamped automatically on the
  // first write attempt and carried through the outbox, so an event drained
  // hours later still records its true time (audit_logs.occurred_at). The
  // chain's created_at is chosen by the DATABASE clock inside
  // write_audit_entry_atomic (0048) and cannot be set from here.
  occurredAt?: string;
};

// Postgres jsonb renders non-integer numbers with their stored precision
// ("1.0") while JS JSON.stringify(1.0) yields "1" — one float in metadata
// would make the SQL-computed entry hash unverifiable from the JS verifiers.
// Integers, strings, booleans, null, and nested arrays/objects of those are
// canonicalisation-safe; anything else is serialised to a string BEFORE it
// reaches the chain. (See audit_canonical_json in migration 0029.)
function sanitizeMetadataValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? value : String(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(sanitizeMetadataValue);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeMetadataValue(v);
    }
    return out;
  }
  return String(value);
}

export function sanitizeAuditMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> {
  return (sanitizeMetadataValue(metadata ?? {}) ?? {}) as Record<string, unknown>;
}

// Stable JSON serialisation: sort keys recursively so the hash is reproducible.
function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  const body = keys.map((k) => JSON.stringify(k) + ":" + canonicalJson((v as Record<string, unknown>)[k])).join(",");
  return "{" + body + "}";
}

function computeEntryHash(prevHash: string | null, row: Record<string, unknown>): string {
  const h = createHash("sha256");
  h.update(prevHash ?? "");
  h.update("|");
  h.update(canonicalJson(row));
  return h.digest("hex");
}

// The writer hashes `created_at` as a JS ISO string (e.g. "…624Z"), but
// Postgres/PostgREST return timestamptz as "…624+00:00". Hashing the raw DB
// string would never match the stored hash, so verification must canonicalise
// the timestamp back to the same instant representation the writer used.
function canonicalTimestamp(ts: unknown): string {
  return new Date(ts as string).toISOString();
}

const MAX_TRANSIENT_RETRIES = 4;
const TRANSIENT_BACKOFF_MS = 250;
const AUDIT_TIMEOUT_BUDGET_MS = 4000;
// Outbox draining runs ONLY from the scheduled cron
// (/api/v1/internal/drain-audit-outbox) — never opportunistically from a
// request handler. The previous in-request drain fanned out service_role REST
// calls from every serverless instance; the in-memory rate-limit could not
// bound it because module state resets on each cold start, so a stuck outbox
// turned a transient audit outage into database-CPU exhaustion. Cross-instance
// safety now comes from a DB lease (try_acquire_maintenance_lock), not from
// module-level variables.
const OUTBOX_DRAIN_BATCH = 50; // rows fetched per query
const OUTBOX_DRAIN_MAX_PER_RUN = 1000; // hard ceiling of attempts per cron run
const OUTBOX_DEAD_LETTER_AFTER = 10; // stop retrying an event after N failures
const OUTBOX_DRAIN_LOCK_TTL_S = 120; // lease length for one drain run

// Soft, per-instance latency guard: when the atomic audit RPC is failing we stop
// hammering it for 10s on THIS instance. This is an optimisation, not the
// amplification guard — that is the removal of the in-request drain (above).
// Each request's synchronous write is already bounded (MAX_TRANSIENT_RETRIES
// then enqueue), so it never fans out regardless of this flag.
let auditCircuitOpenUntil = 0;
let outboxDrainInFlight = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(p: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("audit_timeout_budget_exceeded")), timeoutMs)),
  ]);
}

function isTransientAuditError(err: { code?: string; message?: string }): boolean {
  const msg = (err.message ?? "").toLowerCase();
  return err.code === "40001" || msg.includes("timeout") || msg.includes("temporar") || msg.includes("upstream");
}

async function enqueueAudit(input: AuditInput, reason: string): Promise<void> {
  const admin = getSupabaseAdmin();
  logSupabaseCall({ caller: "enqueueAudit", client: "admin", action: "insert", target: "audit_log_outbox" });
  const { error } = await admin.from("audit_log_outbox").insert({
    payload_json: input,
    reason,
    available_at: new Date().toISOString(),
  });
  if (error) {
    console.error("[audit] outbox enqueue failed", { reason, error: error.message, code: (error as { code?: string }).code });
  }
}

export type OutboxDrainSummary = {
  processed: number;
  dead_lettered: number;
  attempted: number;
  acquired_lock: boolean;
};

// Drains queued audit events into the hash-chained log. Invoked ONLY by the
// scheduled cron (see /api/v1/internal/drain-audit-outbox). A DB lease ensures
// at most one drain runs across all serverless instances at a time; work is
// processed in bounded batches with a hard per-run ceiling; events that keep
// failing are dead-lettered so they are never retried in an unbounded loop.
export async function drainAuditOutbox(): Promise<OutboxDrainSummary> {
  const summary: OutboxDrainSummary = { processed: 0, dead_lettered: 0, attempted: 0, acquired_lock: false };
  if (outboxDrainInFlight) return summary; // cheap same-instance reentrancy guard
  outboxDrainInFlight = true;
  const admin = getSupabaseAdmin();

  try {
    // Cross-instance guard: skip this run if another drain holds the lease.
    const { data: acquired, error: lockErr } = await admin.rpc("try_acquire_maintenance_lock", {
      p_name: "outbox_drain",
      p_ttl_seconds: OUTBOX_DRAIN_LOCK_TTL_S,
    });
    if (lockErr) {
      console.error("[audit] drain lock acquire failed", { error: lockErr.message });
      return summary;
    }
    if (acquired !== true) return summary;
    summary.acquired_lock = true;

    try {
      while (summary.attempted < OUTBOX_DRAIN_MAX_PER_RUN) {
        const { data, error } = await admin
          .from("audit_log_outbox")
          .select("id, payload_json, attempt_count")
          .is("processed_at", null)
          .is("dead_lettered_at", null)
          .lte("available_at", new Date().toISOString())
          .order("created_at", { ascending: true })
          .limit(OUTBOX_DRAIN_BATCH);
        if (error) {
          console.error("[audit] drain select failed", { error: error.message });
          break;
        }
        if (!data?.length) break;

        for (const item of data) {
          summary.attempted++;
          const input = item.payload_json as AuditInput;
          const ok = await writeAuditImmediate(input);
          if (ok) {
            await admin
              .from("audit_log_outbox")
              .update({ processed_at: new Date().toISOString(), last_error: null })
              .eq("id", item.id);
            summary.processed++;
          } else {
            const attempts = (item.attempt_count ?? 0) + 1;
            if (attempts >= OUTBOX_DEAD_LETTER_AFTER) {
              await admin
                .from("audit_log_outbox")
                .update({ attempt_count: attempts, dead_lettered_at: new Date().toISOString(), last_error: "dead_letter" })
                .eq("id", item.id);
              summary.dead_lettered++;
            } else {
              await admin
                .from("audit_log_outbox")
                .update({
                  attempt_count: attempts,
                  last_error: "write_failed",
                  available_at: new Date(Date.now() + Math.min(30_000, attempts * 1_000)).toISOString(),
                })
                .eq("id", item.id);
            }
          }
        }
        if (data.length < OUTBOX_DRAIN_BATCH) break;
      }
    } finally {
      const { error: relErr } = await admin.rpc("release_maintenance_lock", { p_name: "outbox_drain" });
      if (relErr) console.error("[audit] drain lock release failed", { error: relErr.message });
    }
  } finally {
    outboxDrainInFlight = false;
  }

  return summary;
}

async function writeAuditImmediate(input: AuditInput): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const hasServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  // p_created_at feeds audit_logs.occurred_at (0048): the time the action
  // happened, surviving outbox delays. The chain's created_at is stamped by
  // the DB clock inside the function and cannot be influenced from here.
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  logSupabaseCall({ caller: "writeAuditImmediate", client: "admin", action: "rpc", target: "write_audit_entry_atomic" });
  const { error } = await admin.rpc("write_audit_entry_atomic", {
    p_actor_user_id: input.actorUserId,
    p_actor_role: input.actorRole,
    p_action: input.action,
    p_entity_type: input.entityType ?? null,
    p_entity_id: input.entityId ?? null,
    p_patient_id: input.patientId ?? null,
    p_metadata_json: sanitizeAuditMetadata(input.metadata),
    p_ip_address: input.ipAddress ?? null,
    p_user_agent: input.userAgent ?? null,
    p_created_at: occurredAt,
  });

  if (!error) return true;

  const code = (error as { code?: string }).code;
  const message = (error as { message?: string }).message ?? "";
  if (code === "40001" && message.includes("lock busy")) {
    console.warn("[audit] atomic chain lock busy — deferring to outbox", {
      action: input.action,
    });
    return false;
  }

  console.error("[audit] atomic insert failed", {
    hasServiceRoleKey,
    action: input.action,
    error: error.message,
    code,
    details: (error as { details?: string }).details,
  });

  return false;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  // Stamp the event time on the FIRST attempt so retries and the outbox carry
  // the original moment, not whenever the write finally succeeded.
  if (!input.occurredAt) input = { ...input, occurredAt: new Date().toISOString() };

  if (Date.now() < auditCircuitOpenUntil) {
    await enqueueAudit(input, "circuit_open");
    return;
  }

  // NOTE: we deliberately do NOT drain the outbox here. Draining is the cron's
  // job (/api/v1/internal/drain-audit-outbox). Doing it per-request is what
  // amplified service_role traffic into a database-CPU outage.

  const start = Date.now();
  for (let attempt = 0; attempt < MAX_TRANSIENT_RETRIES; attempt++) {
    try {
      const remainingBudget = AUDIT_TIMEOUT_BUDGET_MS - (Date.now() - start);
      if (remainingBudget <= 0) throw new Error("audit_timeout_budget_exceeded");
      const ok = await withTimeout(writeAuditImmediate(input), remainingBudget);
      if (ok) return;
      throw new Error("audit_write_failed");
    } catch (err) {
      const e = err as { code?: string; message?: string };
      const transient = isTransientAuditError(e);
      if (!transient || attempt === MAX_TRANSIENT_RETRIES - 1) {
        auditCircuitOpenUntil = Date.now() + 10_000;
        console.error("[audit] degraded_to_outbox", { action: input.action, transient, error: e.message });
        await enqueueAudit(input, transient ? "transient_exhausted" : "non_transient");
        return;
      }
      await sleep(TRANSIENT_BACKOFF_MS * (attempt + 1));
    }
  }
}

// Chain verification. Used by the daily cron (AC-7) and the
// scripts/verify-audit-chain.mjs admin tool.
//
// Walk order is chain_position (0048) — the chain's physical insertion order —
// never created_at, which clock skew between writers can reorder.
//
// Incremental by default: a checkpoint row (audit_verify_checkpoints, 0049)
// records the last position+hash that verified clean, and the next run resumes
// from there, keeping the daily cron O(new rows) instead of O(history).
// `full: true` re-walks from genesis (weekly / on demand / after any incident).
// The checkpoint only ever advances after a clean segment.
const VERIFY_CHECKPOINT_NAME = "audit_chain";

type VerifyOptions = { full?: boolean };

export async function verifyChain(options: VerifyOptions = {}): Promise<{
  ok: boolean;
  brokenAt?: string;
  checked: number;
  from_position: number;
}> {
  const admin = getSupabaseAdmin();
  const pageSize = 1000;

  let cursorPosition = 0;
  let prevHash: string | null = null;

  if (!options.full) {
    const { data: checkpoint, error: cpErr } = await admin
      .from("audit_verify_checkpoints")
      .select("last_position, last_entry_hash")
      .eq("name", VERIFY_CHECKPOINT_NAME)
      .maybeSingle();
    // A checkpoint read failure is not a verification failure — fall back to a
    // full walk rather than reporting the chain broken.
    if (!cpErr && checkpoint) {
      cursorPosition = checkpoint.last_position;
      prevHash = checkpoint.last_entry_hash;
    }
  }

  const startPosition = cursorPosition;
  let checked = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await admin
      .from("audit_logs")
      .select("*")
      .gt("chain_position", cursorPosition)
      .order("chain_position", { ascending: true })
      .limit(pageSize);
    if (error) {
      return { ok: false, brokenAt: `query_failed_after_${cursorPosition}`, checked, from_position: startPosition };
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      // Explicit field list: chain_position, occurred_at, and chain_anchor_id
      // ride OUTSIDE the entry hash by design.
      const expected = computeEntryHash(prevHash, {
        actor_user_id: row.actor_user_id,
        actor_role: row.actor_role,
        action: row.action,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        patient_id: row.patient_id,
        metadata_json: row.metadata_json,
        ip_address: row.ip_address,
        user_agent: row.user_agent,
        created_at: canonicalTimestamp(row.created_at),
        prev_hash: row.prev_hash,
      });
      if (expected !== row.entry_hash) {
        return { ok: false, brokenAt: row.id, checked, from_position: startPosition };
      }
      prevHash = row.entry_hash;
      cursorPosition = row.chain_position;
      checked++;
    }

    if (data.length < pageSize) break;
  }

  // Advance the checkpoint only after a clean walk, and only when there was a
  // verified tail to record.
  if (checked > 0 && prevHash) {
    const { error: upsertErr } = await admin.from("audit_verify_checkpoints").upsert({
      name: VERIFY_CHECKPOINT_NAME,
      last_position: cursorPosition,
      last_entry_hash: prevHash,
      verified_at: new Date().toISOString(),
    });
    if (upsertErr) {
      console.error("[audit-chain] checkpoint update failed", { error: upsertErr.message });
    }
  }

  return { ok: true, checked, from_position: startPosition };
}
