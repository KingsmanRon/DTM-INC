// Called by /mfa/enrol after a successful TOTP verify. Flips app_users.mfa_enabled
// to true so /admin/users reports the correct state. Supabase Auth is the
// source of truth for the factor itself; this is only a mirror flag.
//
// Verifies server-side that the caller actually has a VERIFIED TOTP factor
// before flipping the flag. Without this, a malicious client could POST
// directly to claim MFA without going through enrolment.
import { requireSession } from "@/lib/auth/session";
import { getSupabaseServer, getSupabaseAdmin } from "@/lib/supabase/server";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await requireSession();

    // listFactors runs under the user's auth context and returns only their
    // own factors. A TOTP factor's status is 'verified' once the user has
    // submitted a valid code during enrolment.
    const supabase = await getSupabaseServer();
    const { data: factors, error: factorsErr } = await supabase.auth.mfa.listFactors();
    if (factorsErr) return jsonError(500, "mfa_factor_lookup_failed", factorsErr.message);
    const hasVerifiedTotp = (factors?.totp ?? []).some((f) => f.status === "verified");
    if (!hasVerifiedTotp) {
      return jsonError(400, "totp_not_verified", "No verified TOTP factor on this account.");
    }

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
