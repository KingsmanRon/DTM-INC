import { requireRole } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { handleRouteError, jsonOk } from "@/lib/api/http";

export async function GET() {
  try {
    await requireRole(["doctor", "staff", "admin"]);
    const admin = getSupabaseAdmin();
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    const { data, error } = await admin
      .from("appointment_queue")
      .select("id, appointment_id, patient_id, doctor_id, queue_date, queue_number, status, queued_at, in_room_at, completed_at")
      .eq("queue_date", start.toISOString().slice(0, 10))
      .in("status", ["queued", "called", "in_room"])
      .order("queue_number", { ascending: true });

    if (error) throw error;
    return jsonOk({ queue: data ?? [] });
  } catch (err) {
    return handleRouteError(err);
  }
}
