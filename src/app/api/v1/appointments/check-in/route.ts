import { type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { clientIp, handleRouteError, jsonError, jsonOk } from "@/lib/api/http";
import { writeAudit } from "@/lib/audit/log";

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const body = (await req.json()) as { appointmentId?: string };
    const appointmentId = String(body.appointmentId ?? "").trim();
    if (!appointmentId) return jsonError(400, "appointment_id_required");

    const admin = getSupabaseAdmin();
    const checkedInAt = new Date().toISOString();
    const { data, error } = await admin
      .from("appointments")
      .update({ status: "arrived", checked_in_at: checkedInAt, updated_by: session.userId })
      .eq("id", appointmentId)
      .select("id, patient_id, doctor_id, scheduled_at")
      .maybeSingle();

    if (error) throw error;
    if (!data) return jsonError(404, "not_found");

    const queueDate = new Date(data.scheduled_at ?? checkedInAt).toISOString().slice(0, 10);
    const { count } = await admin
      .from("appointment_queue")
      .select("id", { count: "exact", head: true })
      .eq("doctor_id", data.doctor_id)
      .eq("queue_date", queueDate);
    const queueNumber = (count ?? 0) + 1;

    await admin.from("appointment_queue").upsert({
      appointment_id: data.id,
      patient_id: data.patient_id,
      doctor_id: data.doctor_id,
      queue_date: queueDate,
      queue_number: queueNumber,
      status: "queued",
      queued_at: checkedInAt,
      created_by: session.userId,
      updated_by: session.userId,
    }, { onConflict: "appointment_id" });

    await writeAudit({ actorUserId: session.userId, actorRole: session.role, action: "appointment_check_in", entityType: "appointment", entityId: data.id, patientId: data.patient_id, metadata: { queue_number: queueNumber }, ipAddress: clientIp(req), userAgent: req.headers.get("user-agent") });

    return jsonOk({ queueNumber });
  } catch (err) {
    return handleRouteError(err);
  }
}
