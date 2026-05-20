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
      .select("*")
      .gte("scheduled_at", start.toISOString())
      .lt("scheduled_at", end.toISOString())
      .order("scheduled_at", { ascending: true });

    if (error) throw error;
    return jsonOk({ appointments: data ?? [] });
  } catch (err) {
    return handleRouteError(err);
  }
}
