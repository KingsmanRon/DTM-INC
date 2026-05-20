import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit/log";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { clientIp, handleRouteError, jsonError, jsonOk, parseJson } from "@/lib/api/http";

const UpdateQueueStatusSchema = z.object({
  status: z.enum(["in_room", "completed"]),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const { id } = await params;
    const body = await parseJson(req, UpdateQueueStatusSchema);
    const admin = getSupabaseAdmin();

    const updatePayload: Record<string, unknown> = { status: body.status, updated_by: session.userId };
    if (body.status === "in_room") updatePayload.in_room_at = new Date().toISOString();
    if (body.status === "completed") updatePayload.completed_at = new Date().toISOString();

    const { data, error } = await admin
      .from("appointment_queue")
      .update(updatePayload)
      .eq("id", id)
      .select("id, patient_id, status, in_room_at, completed_at")
      .maybeSingle();

    if (error) throw error;
    if (!data) return jsonError(404, "not_found");

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: body.status === "in_room" ? "consultation_start" : "consultation_complete",
      entityType: "appointment_queue",
      entityId: data.id,
      patientId: data.patient_id,
      metadata: { status: data.status, in_room_at: data.in_room_at, completed_at: data.completed_at },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ appointment: data });
  } catch (err) {
    return handleRouteError(err);
  }
}
