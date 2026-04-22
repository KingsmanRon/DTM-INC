// Un-archive endpoint. Per review item (soft-delete round-trip test §6).
// Used for POPIA subject-access-request restores and for correcting
// accidental archivals. Doctor + admin only. Every un-archive emits an
// audit row, same as the archive.
import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { clientIp, handleRouteError, jsonError, jsonOk } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["doctor", "admin"]);
    const { id } = await params;
    const supabase = await getSupabaseServer();

    const { error } = await supabase
      .from("patients")
      .update({ status: "active", archived_at: null, archived_by: null })
      .eq("id", id)
      .eq("status", "archived");
    if (error) return jsonError(500, "db_error", error.message);

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
