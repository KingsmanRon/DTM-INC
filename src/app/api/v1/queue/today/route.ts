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
      .from("appointments")
      .select("id, patient_id, scheduled_at, checked_in_at, status")
      .gte("scheduled_at", start.toISOString())
      .lt("scheduled_at", end.toISOString())
      .in("status", ["arrived", "in_progress"])
      .order("checked_in_at", { ascending: true, nullsFirst: false });

    if (error) throw error;
    return jsonOk({ queue: data ?? [] });
  } catch (err) {
    return handleRouteError(err);
  }
}
