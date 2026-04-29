// POST /api/v1/admin/users/:id/activate
//
// Admin-only. Re-enables a previously deactivated account. Audit action
// reuses permission_change because there's no dedicated user_activate
// enum value; the metadata distinguishes the transition.
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
    const admin = getSupabaseAdmin();

    const { data, error } = await admin
      .from("app_users")
      .update({ status: "active", updated_by: session.userId })
      .eq("id", id)
      .select("id, email")
      .maybeSingle();
    if (error) return jsonError(500, "db_error", error.message);
    if (!data) return jsonError(404, "not_found");

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "permission_change",
      entityType: "app_users",
      entityId: id,
      metadata: { email: data.email, transition: "activate" },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
