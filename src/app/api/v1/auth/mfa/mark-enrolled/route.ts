// Called by /mfa/enrol after a successful TOTP verify. Flips app_users.mfa_enabled
// to true so /admin/users reports the correct state. Supabase Auth is the
// source of truth for the factor itself; this is only a mirror flag.
import { requireSession } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await requireSession();
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from("app_users")
      .update({ mfa_enabled: true, mfa_enrolled_at: new Date().toISOString() })
      .eq("id", session.userId);
    if (error) return jsonError(500, "db_error", error.message);
    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
