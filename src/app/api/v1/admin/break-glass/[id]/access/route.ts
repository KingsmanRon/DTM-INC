// Break-glass read of clinical notes by admin (§10.4).
//
// Preconditions enforced here:
//   1. Caller is admin (3-layer role check).
//   2. Request belongs to THIS admin (no lateral access).
//   3. Request is not revoked_at.
//   4. cool_off_until is in the past (48h elapsed).
//   5. If this is the first access, set access_window_ends = now + 24h.
//   6. If access_window_ends < now, reject (window expired — new request required).
//
// This endpoint uses the service-role client because clinical_notes RLS is
// doctor-only; bypass is ONLY permitted here, after the above gates pass.
// Every read emits a `break_glass_access` audit row tagged with the request id.
//
// NOT YET WIRED: doctor-notification email on request creation. That belongs
// to a Supabase Edge Function or Railway worker and is ticketed for v2. Until
// it ships, the practice policy must be that break-glass creation is
// announced to the doctor out of band.

import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { decryptNoteBody, unwrapDek, zero } from "@/lib/crypto/envelope";
import { byteaToCryptoBuffer } from "@/lib/bytea";
import { clientIp, handleRouteError, jsonError, jsonOk } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCESS_WINDOW_MS = 24 * 3600 * 1000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole("admin");
    const { id } = await params;
    const admin = getSupabaseAdmin();

    // 1. Load + validate the request row.
    const { data: request, error: reqErr } = await admin
      .from("break_glass_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (reqErr || !request) return jsonError(404, "not_found");

    if (request.requester_user_id !== session.userId) return jsonError(404, "not_found");
    if (request.revoked_at) return jsonError(403, "request_revoked");

    const now = Date.now();
    if (new Date(request.cool_off_until).getTime() > now) {
      return jsonError(403, "cool_off_active", `Cool-off ends at ${request.cool_off_until}`);
    }

    // 2. Compute / enforce the 24h access window.
    let accessWindowEnds = request.access_window_ends ? new Date(request.access_window_ends).getTime() : null;
    if (!request.accessed_at) {
      accessWindowEnds = now + ACCESS_WINDOW_MS;
      await admin
        .from("break_glass_requests")
        .update({
          accessed_at: new Date(now).toISOString(),
          access_window_ends: new Date(accessWindowEnds).toISOString(),
        })
        .eq("id", id);
    } else if (accessWindowEnds === null || accessWindowEnds < now) {
      return jsonError(403, "access_window_expired");
    }

    // 3. AUDIT BEFORE ACCESS. Write the break_glass_access row BEFORE fetching
    //    and decrypting any notes. If the decrypt crashes, the response is
    //    dropped by the network, or an attacker injects a panic mid-flight,
    //    the attempt is still recorded. Auditing after the decrypt would
    //    leave a hole where the data was accessed but no audit row exists
    //    — that is the whole class of defect break-glass is designed to
    //    prevent.
    await writeAudit({
      actorUserId: session.userId,
      actorRole: "admin",
      action: "break_glass_access",
      entityType: "break_glass_requests",
      entityId: id,
      patientId: request.target_patient_id,
      metadata: {
        request_id: id,
        access_window_ends: new Date(accessWindowEnds!).toISOString(),
        phase: "pre_fetch",
      },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    // 4. Fetch + decrypt notes. Same envelope flow as doctor, but bypassing
    //    RLS via the service-role client — gated by every check above plus
    //    the audit row we just wrote.
    const { data: keyRow } = await admin
      .from("patient_encryption_keys")
      .select("id, wrapped_dek")
      .eq("patient_id", request.target_patient_id)
      .maybeSingle();

    const { data: notes } = await admin
      .from("clinical_notes")
      .select("id, note_date, encrypted_body, nonce, is_finalised, amended_from_note_id, created_at, updated_at")
      .eq("patient_id", request.target_patient_id)
      .order("created_at", { ascending: false });

    const results: Array<{ id: string; note_date: string; body: string; is_finalised: boolean; created_at: string }> = [];

    if (keyRow && notes && notes.length > 0) {
      const wrapped = byteaToCryptoBuffer(keyRow.wrapped_dek);
      const dek = await unwrapDek(wrapped);
      try {
        for (const n of notes) {
          const ct = byteaToCryptoBuffer(n.encrypted_body);
          const nonce = byteaToCryptoBuffer(n.nonce);
          results.push({
            id: n.id,
            note_date: n.note_date,
            body: decryptNoteBody(dek, ct, nonce),
            is_finalised: n.is_finalised,
            created_at: n.created_at,
          });
        }
      } finally {
        zero(dek);
      }
    }

    return jsonOk({ notes: results, access_window_ends: new Date(accessWindowEnds!).toISOString() });
  } catch (err) {
    return handleRouteError(err);
  }
}
