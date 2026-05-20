import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit/log";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { clientIp, handleRouteError, jsonError, jsonOk, parseJson } from "@/lib/api/http";

const UpdateAppointmentSchema = z.object({
  scheduled_at: z.string().datetime().optional(),
  reason: z.string().trim().min(1).max(400).optional(),
  notes: z.string().trim().max(4000).optional(),
  status: z.enum(["scheduled", "arrived", "in_progress", "completed", "cancelled", "no_show"]).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: "at_least_one_field_required" });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const { id } = await params;
    const body = await parseJson(req, UpdateAppointmentSchema);
    const admin = getSupabaseAdmin();

    const { data, error } = await admin
      .from("appointments")
      .update({ ...body, updated_by: session.userId })
      .eq("id", id)
      .select("id, patient_id, scheduled_at, status")
      .maybeSingle();

    if (error) throw error;
    if (!data) return jsonError(404, "not_found");

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "appointment_update",
      entityType: "appointment",
      entityId: data.id,
      patientId: data.patient_id,
      metadata: body,
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ appointment: data });
  } catch (err) {
    return handleRouteError(err);
  }
}
