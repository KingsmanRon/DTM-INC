// GET /api/v1/admin/break-glass — the caller's own break-glass requests.
//
// Powers the /admin/break-glass screen (review #19: the request/access
// endpoints existed but nothing listed them, so the workflow was unusable
// without curl). Admin-only, and deliberately scoped to the REQUESTER's own
// rows — one admin cannot enumerate another's emergency accesses here; the
// full record lives in the audit log.
import { requireRole } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireRole("admin");
    const admin = getSupabaseAdmin();

    const { data, error } = await admin
      .from("break_glass_requests")
      .select("id, target_patient_id, justification, requested_at, cool_off_until, accessed_at, access_window_ends, revoked_at")
      .eq("requester_user_id", session.userId)
      .order("requested_at", { ascending: false })
      .limit(50);
    if (error) return jsonError(500, "db_error", error.message);

    return jsonOk({ requests: data ?? [] });
  } catch (err) {
    return handleRouteError(err);
  }
}
