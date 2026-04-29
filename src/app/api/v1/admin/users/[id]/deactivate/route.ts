// POST /api/v1/admin/users/:id/deactivate
//
// Admin-only. Sets app_users.status='deactivated'. resolveSession() refuses
// non-active users (lib/auth/session.ts), so the next request from this
// account is bounced to /unauthorised. The auth.users row is intentionally
// left intact: the user keeps appearing in the audit trail, can be
// reactivated, and a forensics audit can still resolve their identity.
//
// Refuses to deactivate the caller's own account — the operator can lock
// themselves out otherwise.
import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { clientIp, handleRouteError, jsonError, jsonOk } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole("admin");
    const { id } = await params;
    if (id === session.userId) return jsonError(400, "cannot_deactivate_self");

    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("app_users")
      .update({ status: "deactivated", updated_by: session.userId })
      .eq("id", id)
      .select("id, email")
      .maybeSingle();
    if (error) return jsonError(500, "db_error", error.message);
    if (!data) return jsonError(404, "not_found");

    // Invalidate any active sessions for the user. signOut on the auth
    // admin API revokes refresh tokens cluster-wide; without this they
    // could keep using a fresh access token until it expires (~1h).
    await admin.auth.admin.signOut(id).catch(() => { /* best-effort */ });

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "user_deactivate",
      entityType: "app_users",
      entityId: id,
      metadata: { email: data.email },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
