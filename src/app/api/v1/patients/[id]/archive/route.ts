import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { clientIp, handleRouteError, jsonError, jsonOk } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Service-only RPC preserves admin's archive authority without granting admin
// demographics access. The state change and durable audit commit together.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["doctor", "admin"]);
    const { id } = await params;
    const { data, error } = await getSupabaseAdmin().rpc("set_patient_archive_state", {
      p_patient_id: id,
      p_archived: true,
      p_actor_user_id: session.userId,
      p_ip_address: clientIp(req),
      p_user_agent: req.headers.get("user-agent"),
    });
    if (error) {
      if (error.code === "PT404" || error.code === "42501") return jsonError(404, "not_found");
      if (error.code === "PT409") return jsonError(409, "already_archived");
      return jsonError(500, "db_error");
    }
    if (typeof data !== "string" || data.toLowerCase() !== id.toLowerCase()) return jsonError(500, "db_error");
    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
