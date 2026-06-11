// Un-archive endpoint. Per review item (soft-delete round-trip test §6).
// Used for POPIA subject-access-request restores and for correcting
// accidental archivals. Doctor + admin only. Every un-archive emits an
// audit row — but ONLY when a row actually transitioned (see archive route
// for why this uses the service-role client and verifies its own effect).
import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { clientIp, handleRouteError, jsonError, jsonOk } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["doctor", "admin"]);
    const { id } = await params;
    const admin = getSupabaseAdmin();

    const { data: existing, error: readErr } = await admin
      .from("patients")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();
    if (readErr) return jsonError(500, "db_error", readErr.message);
    if (!existing) return jsonError(404, "not_found");
    if (existing.status !== "archived") {
      return jsonError(409, "not_archived", "This patient is not archived.");
    }

    const { data: updated, error } = await admin
      .from("patients")
      .update({ status: "active", archived_at: null, archived_by: null })
      .eq("id", id)
      .eq("status", "archived")
      .select("id")
      .maybeSingle();
    if (error) return jsonError(500, "db_error", error.message);
    if (!updated) return jsonError(409, "not_archived", "This patient is not archived.");

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "patient_unarchive",
      entityType: "patient",
      entityId: id,
      patientId: id,
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
