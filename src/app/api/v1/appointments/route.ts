import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit/log";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { clientIp, handleRouteError, jsonOk, parseJson } from "@/lib/api/http";

const CreateAppointmentSchema = z.object({
  patient_id: z.string().uuid(),
  scheduled_at: z.string().datetime(),
  reason: z.string().trim().min(1).max(400).optional(),
  notes: z.string().trim().max(4000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const body = await parseJson(req, CreateAppointmentSchema);
    const admin = getSupabaseAdmin();

    const { data, error } = await admin
      .from("appointments")
      .insert({
        patient_id: body.patient_id,
        scheduled_at: body.scheduled_at,
        reason: body.reason ?? null,
        notes: body.notes ?? null,
        status: "scheduled",
        created_by: session.userId,
      })
      .select("id, patient_id, scheduled_at, status")
      .single();

    if (error) throw error;

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "appointment_create",
      entityType: "appointment",
      entityId: data.id,
      patientId: data.patient_id,
      metadata: { scheduled_at: data.scheduled_at, status: data.status },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ appointment: data }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
