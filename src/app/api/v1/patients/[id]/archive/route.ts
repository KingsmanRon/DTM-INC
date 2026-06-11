import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { clientIp, handleRouteError, jsonError, jsonOk } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Soft-delete only (§4.6). Hard delete never exists in the app code path.
//
// Uses the service-role client BY DESIGN: the authz matrix (§9) allows admin to
// archive, but admin has no RLS write on patients (doctor/staff only), so an
// RLS-client update for an admin matched 0 rows while the route still returned
// ok AND wrote a patient_archive audit row for an archive that never happened.
// requireRole() is the authorisation; the update verifies its own effect and
// the audit row is only written when a row actually transitioned.
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
    if (existing.status === "archived") {
      return jsonError(409, "already_archived", "This patient is already archived.");
    }

    const { data: updated, error } = await admin
      .from("patients")
      .update({ status: "archived", archived_at: new Date().toISOString(), archived_by: session.userId })
      .eq("id", id)
      .eq("status", "active")
      .select("id")
      .maybeSingle();
    if (error) return jsonError(500, "db_error", error.message);
    // Raced by a concurrent archive — nothing transitioned, so do not audit.
    if (!updated) return jsonError(409, "already_archived", "This patient is already archived.");

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "patient_archive",
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
