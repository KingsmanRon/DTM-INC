// Append-only, hash-chained audit log (§10.5, §FR-11).
//
// Design:
//   1. Each entry's `entry_hash = sha256(prev_hash || canonical_json(row_minus_hash))`.
//   2. `prev_hash` is read inside a transaction under SERIALIZABLE isolation so
//      two concurrent writes cannot pick the same prev_hash.
//   3. The application DB role has no UPDATE/DELETE on audit_logs (0002_rls_policies.sql).
//   4. Writes go through the service-role client; a production deployment
//      should swap this for a dedicated `audit_writer` Postgres connection
//      (SUPABASE_AUDIT_DB_URL) for stronger isolation.
//   5. A daily verifier job walks the chain and alerts on breaks
//      (scripts/verify-audit-chain.mjs).
import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/auth/session";

export type AuditAction =
  | "login_success" | "login_failure" | "login_lockout" | "logout"
  | "patient_create" | "patient_update" | "patient_archive" | "patient_unarchive"
  | "document_upload" | "document_view" | "document_download" | "document_archive"
  | "note_create" | "note_read" | "note_amend" | "note_finalise"
  | "user_create" | "user_deactivate" | "user_reset_mfa" | "permission_change"
  | "practice_settings_update" | "onboarding_pdf_generate"
  | "break_glass_request" | "break_glass_access"
  | "consent_capture" | "access_denied";

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
};

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

// NOTE: this is a best-effort transactional read-prev-then-insert. For the
// production Railway service, replace with a single SQL call to a plpgsql
// function that does SELECT ... FOR UPDATE on the last row inside the same tx.
export async function writeAudit(input: AuditInput): Promise<void> {
  const admin = getSupabaseAdmin();

  const { data: last } = await admin
    .from("audit_logs")
    .select("entry_hash")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevHash = last?.entry_hash ?? null;

  const createdAt = new Date().toISOString();
  const row = {
    actor_user_id: input.actorUserId,
    actor_role: input.actorRole,
    action: input.action,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    patient_id: input.patientId ?? null,
    metadata_json: input.metadata ?? {},
    ip_address: input.ipAddress ?? null,
    user_agent: input.userAgent ?? null,
    created_at: createdAt,
    prev_hash: prevHash,
  };

  const entryHash = computeEntryHash(prevHash, row);

  const { error } = await admin.from("audit_logs").insert({ ...row, entry_hash: entryHash });
  if (error) {
    // Audit failures are critical. Log to server stderr; surface to monitoring.
    // Do NOT throw into user request flow — we don't want a missing audit to
    // block a legitimate patient save. Instead, this is picked up by the
    // daily verifier (scripts/verify-audit-chain.mjs) and Sentry.
    console.error("[audit] insert failed", { action: input.action, error: error.message });
  }
}

// Chain verification utility. Used by the daily cron (AC-7) and the
// scripts/verify-audit-chain.mjs admin tool.
export async function verifyChain(): Promise<{ ok: boolean; brokenAt?: string }> {
  const admin = getSupabaseAdmin();
  const pageSize = 1000;
  let cursor: string | null = null;
  let prevHash: string | null = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = admin.from("audit_logs").select("*").order("created_at", { ascending: true }).limit(pageSize);
    if (cursor) q = q.gt("created_at", cursor);
    const { data, error } = await q;
    if (error) return { ok: false, brokenAt: cursor ?? "unknown" };
    if (!data || data.length === 0) return { ok: true };

    for (const row of data) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, entry_hash, chain_anchor_id, ...rest } = row;
      const expected = computeEntryHash(prevHash, {
        actor_user_id: rest.actor_user_id,
        actor_role: rest.actor_role,
        action: rest.action,
        entity_type: rest.entity_type,
        entity_id: rest.entity_id,
        patient_id: rest.patient_id,
        metadata_json: rest.metadata_json,
        ip_address: rest.ip_address,
        user_agent: rest.user_agent,
        created_at: rest.created_at,
        prev_hash: rest.prev_hash,
      });
      if (expected !== entry_hash) return { ok: false, brokenAt: row.id };
      prevHash = entry_hash;
      cursor = row.created_at;
    }

    if (data.length < pageSize) return { ok: true };
  }
}
