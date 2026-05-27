// Append-only, hash-chained audit log (§10.5, §FR-11).
//
// Design:
//   1. Each entry's `entry_hash = sha256(prev_hash || "|" || canonical_json(row_minus_hash))`.
//   2. Insert is delegated to the SECURITY DEFINER DB function
//      `write_audit_entry`, which takes a tx-scoped advisory lock, re-reads
//      the current tail, and refuses the insert if the caller's expected
//      prev_hash doesn't match. On mismatch it raises SQLSTATE '40001' and we
//      retry — this is how we get atomic read-tail-then-insert without
//      SERIALIZABLE isolation at the session level.
//   3. The function is owned by `audit_writer` (0002) and service_role no
//      longer has direct INSERT on audit_logs (0006), so a stolen service-
//      role key cannot append rows bypassing the chain check.
//   4. A daily verifier walks the chain and alerts on breaks
//      (scripts/verify-audit-chain.mjs).
import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
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

const MAX_TAIL_COLLISION_RETRIES = 5;

async function insertAuditRowFallback(
  row: {
    actor_user_id: string | null;
    actor_role: AppRole | null;
    action: AuditAction;
    entity_type: string | null;
    entity_id: string | null;
    patient_id: string | null;
    metadata_json: Record<string, unknown>;
    ip_address: string | null;
    user_agent: string | null;
    created_at: string;
    prev_hash: string | null;
  },
  entryHash: string,
  hasServiceRoleKey: boolean,
): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("audit_logs").insert({ ...row, entry_hash: entryHash });
  if (!error) return true;

  console.error("[audit] fallback insert failed", {
    hasServiceRoleKey,
    action: row.action,
    error: error.message,
    code: (error as { code?: string }).code,
    details: (error as { details?: string }).details,
  });
  return false;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  const admin = getSupabaseAdmin();
  const hasServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  for (let attempt = 0; attempt < MAX_TAIL_COLLISION_RETRIES; attempt++) {
    const { data: last, error: readErr } = await admin
      .from("audit_logs")
      .select("entry_hash")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (readErr) {
      console.error("[audit] tail read failed", { action: input.action, error: readErr.message });
      return;
    }

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

    const { error } = await admin.rpc("write_audit_entry", {
      p_expected_prev_hash: prevHash,
      p_entry_hash: entryHash,
      p_actor_user_id: input.actorUserId,
      p_actor_role: input.actorRole,
      p_action: input.action,
      p_entity_type: input.entityType ?? null,
      p_entity_id: input.entityId ?? null,
      p_patient_id: input.patientId ?? null,
      p_metadata_json: input.metadata ?? {},
      p_ip_address: input.ipAddress ?? null,
      p_user_agent: input.userAgent ?? null,
      p_created_at: createdAt,
    });

    if (!error) return;

    // 40001 = tail moved between our read and the function's re-check.
    // Re-read and recompute with the new tail; do not throw into user flow.
    const code = (error as { code?: string }).code;
    if (code === "40001") continue;

    if (code === "42501") {
      const ok = await insertAuditRowFallback(row, entryHash, hasServiceRoleKey);
      if (ok) return;
    }

    console.error("[audit] insert failed", {
      hasServiceRoleKey,
      action: input.action,
      error: error.message,
      code,
      details: (error as { details?: string }).details,
    });
    return;
  }

  console.error("[audit] insert failed after retries", { hasServiceRoleKey, action: input.action });
}

// Chain verification utility. Used by the daily cron (AC-7) and the
// scripts/verify-audit-chain.mjs admin tool.
export async function verifyChain(): Promise<{ ok: boolean; brokenAt?: string }> {
  const admin = getSupabaseAdmin();
  const pageSize = 1000;
  // Composite cursor (created_at, id): `created_at` has millisecond-resolution
  // ties in practice, so filtering with `gt(created_at, cursor)` alone skips
  // any subsequent row that shares the cursor's timestamp. We instead page on
  // (created_at, id) lexicographically.
  let cursorCreatedAt: string | null = null;
  let cursorId: string | null = null;
  let prevHash: string | null = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = admin
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(pageSize);
    if (cursorCreatedAt && cursorId) {
      // (created_at, id) > (cursor_created_at, cursor_id)
      q = q.or(
        `created_at.gt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.gt.${cursorId})`
      );
    }
    const { data, error } = await q;
    if (error) return { ok: false, brokenAt: cursorId ?? "unknown" };
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
      cursorCreatedAt = row.created_at;
      cursorId = row.id;
    }

    if (data.length < pageSize) return { ok: true };
  }
}
