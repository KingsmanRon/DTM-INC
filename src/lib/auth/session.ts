// Session + role resolution used by every protected API route and server
// component. Follows the rule from §10.1: **API layer must re-check role**.
// Returns 404 (not 403) when the caller is authenticated but lacks the
// required role, per FR-2.
//
// CRITICAL: 404-on-forbidden is an information-hiding strategy, not a
// silent refusal. Every denial emits an `access_denied` audit row so the
// refusal is observable in /admin/audit.
import { cache } from "react";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { getSupabaseServer } from "@/lib/supabase/server";
import { logSupabaseCall } from "@/lib/supabase/log";
import { writeAudit } from "@/lib/audit/log";
import {
  APP_PROFILE_QUERY_DESCRIPTION,
  APP_PROFILE_SELECT,
  apiMfaSatisfied,
  getProfileFailureReason,
  profileFromQueryRow,
  sessionFromProfile,
  type AppProfileQueryRow,
  type AppRole,
  type Session,
} from "@/lib/auth/profile";
export type { AppRole, Session } from "@/lib/auth/profile";

export class AuthError extends Error {
  constructor(public readonly code: "unauthenticated" | "forbidden" | "mfa_required") {
    super(code);
  }
}

// The single source of server-verified identity for a request. getUser() hits
// Supabase Auth (/auth/v1/user) to verify the JWT, so it must run AT MOST ONCE
// per request. Wrapped in cache() and shared by resolveSession (profile/role)
// and resolveMfa (verified factors) so neither re-verifies independently.
export const getVerifiedUser = cache(async (): Promise<User | null> => {
  const supabase = await getSupabaseServer();
  logSupabaseCall({
    caller: "getVerifiedUser",
    client: "server",
    action: "auth.getUser",
    target: "/auth/v1/user",
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) {
    console.error("[auth] getUser failed", { message: error.message });
    return null;
  }
  return user ?? null;
});

// Current authenticator assurance level (aal1 | aal2 | null) for the request.
// getAuthenticatorAssuranceLevel() is a LOCAL decode of the session JWT's `aal`
// claim — no /auth/v1/user round-trip. The claim is trustworthy here because
// requireSession() has already run getVerifiedUser() (getUser) to verify the
// token against Supabase Auth, so a forged cookie never reaches this point.
// cache()d so repeated requireRole calls in one request decode once.
export const getAssuranceLevel = cache(async (): Promise<string | null> => {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) {
    console.error("[auth] AAL lookup failed", { message: error.message });
    return null;
  }
  return data?.currentLevel ?? null;
});

export const resolveSession = cache(async (): Promise<Session | null> => {
  const supabase = await getSupabaseServer();

  const user = await getVerifiedUser();
  if (!user) return null;

  // Resolve the app profile under the caller's authenticated RLS context.
  // This intentionally filters by the Supabase Auth user id, not email, because
  // public.app_users.id is the 1:1 mirror of auth.users.id. The role is loaded
  // through the explicit roles:role_id(name) relationship.
  const profileQueryTarget = {
    ...APP_PROFILE_QUERY_DESCRIPTION,
    authenticatedUserId: user.id,
    authenticatedEmail: user.email ?? null,
    select: APP_PROFILE_SELECT,
  };

  console.info("[auth] app profile lookup started", { target: profileQueryTarget });
  logSupabaseCall({ caller: "resolveSession", client: "server", action: "select", target: "app_users" });

  const { data, error } = await supabase
    .from("app_users")
    .select(APP_PROFILE_SELECT)
    .eq("id", user.id)
    .maybeSingle();

  const appUser = profileFromQueryRow((data as AppProfileQueryRow | null) ?? null);
  const failureReason = getProfileFailureReason(appUser);

  if (error) {
    console.error("[auth] app profile lookup failed", {
      target: profileQueryTarget,
      supabaseError: {
        code: error.code ?? null,
        message: error.message ?? null,
        details: error.details ?? null,
        hint: error.hint ?? null,
      },
    });
    return null;
  }

  console.info("[auth] app profile lookup completed", {
    target: profileQueryTarget,
    profileFound: Boolean(appUser),
    missingAppUserRow: !appUser,
    profileStatus: appUser?.status ?? null,
    roleName: appUser?.role_name ?? null,
    failureReason,
  });

  return sessionFromProfile(appUser);
});

export async function requireSession(): Promise<Session> {
  const s = await resolveSession();
  if (!s) throw new AuthError("unauthenticated");
  return s;
}

export async function requireRole(roles: AppRole | AppRole[]): Promise<Session> {
  const allowed = Array.isArray(roles) ? roles : [roles];
  const s = await requireSession();
  if (!allowed.includes(s.role)) {
    // Write access_denied to the audit log BEFORE throwing. Without this
    // row, the 404 would be indistinguishable from a genuinely missing
    // resource, which defeats FR-11's observability goal.
    const h = await headers();
    await writeAudit({
      actorUserId: s.userId,
      actorRole: s.role,
      action: "access_denied",
      entityType: null,
      entityId: null,
      patientId: null,
      metadata: {
        required_roles: allowed,
        actual_role: s.role,
        path: h.get("x-invoke-path") ?? h.get("referer") ?? null,
      },
      ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent"),
    });
    throw new AuthError("forbidden");
  }

  // Step-up (FR-1) at the API layer: a caller who HAS the role but hasn't
  // reached AAL2 (doctor/admin) is refused here, mirroring resolveMfa for the
  // pages. The role is already proven, so there is nothing to hide — return a
  // distinct 403 mfa_required (not the 404 used for role denials) so the SPA
  // can redirect to /mfa/challenge. Audited so AAL1 API probes are observable.
  if (!apiMfaSatisfied(s.role, await getAssuranceLevel())) {
    const h = await headers();
    await writeAudit({
      actorUserId: s.userId,
      actorRole: s.role,
      action: "access_denied",
      entityType: null,
      entityId: null,
      patientId: null,
      metadata: {
        reason: "mfa_required",
        actual_role: s.role,
        path: h.get("x-invoke-path") ?? h.get("referer") ?? null,
      },
      ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent"),
    });
    throw new AuthError("mfa_required");
  }

  return s;
}

// Maps AuthError to HTTP responses per FR-2: 404 on forbidden to avoid
// leaking the existence of restricted resources. mfa_required is a deliberate
// exception — the caller has the role, so a 403 (not 404) lets the client
// step up to AAL2 rather than seeing a misleading not-found.
export function authErrorResponse(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    if (err.code === "unauthenticated") return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err.code === "mfa_required")
      return NextResponse.json(
        { error: "mfa_required", message: "Multi-factor authentication required. Please complete the MFA challenge." },
        { status: 403 }
      );
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  throw err;
}
