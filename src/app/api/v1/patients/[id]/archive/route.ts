import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { clientIp, handleRouteError, jsonError, jsonOk } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Soft-delete only (§4.6). Hard delete never exists in the app code path.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["doctor", "admin"]);
    const { id } = await params;
    const supabase = await getSupabaseServer();

    const { error } = await supabase
      .from("patients")
      .update({ status: "archived", archived_at: new Date().toISOString(), archived_by: session.userId })
      .eq("id", id);
    if (error) return jsonError(500, "db_error", error.message);

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
