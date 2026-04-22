// Session + role resolution used by every protected API route and server
// component. Follows the rule from §10.1: **API layer must re-check role**.
// Returns 404 (not 403) when the caller is authenticated but lacks the
// required role, per FR-2.
//
// CRITICAL: 404-on-forbidden is an information-hiding strategy, not a
// silent refusal. Every denial emits an `access_denied` audit row so the
// refusal is observable in /admin/audit.
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";

export type AppRole = "doctor" | "staff" | "admin";

export type Session = {
  userId: string;
  email: string;
  fullName: string;
  role: AppRole;
};

export class AuthError extends Error {
  constructor(public readonly code: "unauthenticated" | "forbidden") {
    super(code);
  }
}

export async function resolveSession(): Promise<Session | null> {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: appUser, error } = await supabase
    .from("app_users")
    .select("id, email, full_name, status, roles:role_id(name)")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !appUser || appUser.status !== "active") return null;

  const roleRaw = Array.isArray(appUser.roles)
    ? appUser.roles[0]?.name
    : (appUser.roles as { name: AppRole } | null)?.name;
  if (!roleRaw) return null;

  return {
    userId: appUser.id,
    email: appUser.email,
    fullName: appUser.full_name,
    role: roleRaw as AppRole,
  };
}

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
  return s;
}

// Maps AuthError to HTTP responses per FR-2: 404 on forbidden to avoid
// leaking the existence of restricted resources.
export function authErrorResponse(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    if (err.code === "unauthenticated") return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  throw err;
}
