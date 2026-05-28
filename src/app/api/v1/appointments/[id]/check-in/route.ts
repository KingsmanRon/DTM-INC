import { type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit/log";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { clientIp, handleRouteError, jsonError, jsonOk } from "@/lib/api/http";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const { id } = await params;
    const admin = getSupabaseAdmin();
    const checkedInAt = new Date().toISOString();

    const { data, error } = await admin
      .from("appointments")
      .update({ status: "checked_in", checked_in_at: checkedInAt, updated_by: session.userId })
      .eq("id", id)
      .select("id, patient_id, status, checked_in_at")
      .maybeSingle();

    if (error) throw error;
    if (!data) return jsonError(404, "not_found");

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "appointment_check_in",
      entityType: "appointment",
      entityId: data.id,
      patientId: data.patient_id,
      metadata: { checked_in_at: data.checked_in_at, status: data.status },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ appointment: data });
  } catch (err) {
    return handleRouteError(err);
  }
}
