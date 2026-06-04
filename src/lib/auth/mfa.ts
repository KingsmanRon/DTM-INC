// Server-side helpers to decide where an authenticated user should be sent
// based on their MFA state.
//
//   AAL1 = signed in with password only.
//   AAL2 = signed in AND passed an MFA (TOTP) challenge.
//
// Policy (FR-1):
//   * doctor + admin: MFA mandatory on every session. If no factor enrolled →
//     /mfa/enrol. If factor exists and current level is AAL1 → /mfa/challenge.
//   * staff: MFA optional in v1, mandatory in v2. Not gated here today; a
//     phase-2 flag flips this.
import { getSupabaseServer } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/auth/session";

export type MfaDecision =
  | { action: "ok" }
  | { action: "enrol" }
  | { action: "challenge"; factorId: string };

export async function resolveMfa(role: AppRole, route = "/dashboard", userId?: string): Promise<MfaDecision> {
  if (role === "staff") return { action: "ok" };

  const supabase = await getSupabaseServer();

  const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
  const factorCount = factors?.totp?.length ?? 0;
  const verifiedFactorCount = (factors?.totp ?? []).filter((f) => f.status === "verified").length;
  const totp = factors?.totp?.find((f) => f.status === "verified");
  const mfaFailureReason = factorsError?.message
    ?? aalError?.message
    ?? (!totp ? "no_verified_totp_factor" : aal?.currentLevel !== "aal2" ? "aal_not_elevated" : null);

  if (process.env.AUTH_DEBUG === "true") {
    console.info("[auth-mfa]", {
      route,
      userId: userId ?? null,
      aal: aal?.currentLevel ?? null,
      factorCount,
      verifiedFactorCount,
      selectedFactorId: totp?.id ?? null,
      mfaFailureReason,
    });
  }

  if (!totp) return { action: "enrol" };
  if (aal?.currentLevel !== "aal2") return { action: "challenge", factorId: totp.id };
  return { action: "ok" };
}
