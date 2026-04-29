// POST /api/v1/admin/users/invite
//
// Admin-only. Creates a Supabase Auth user (sends a confirmation/invite
// email) and inserts the matching app_users row with the chosen role and
// status='active'. The user clicks the email link, sets a password, and
// the existing /auth/callback flow puts them into the dashboard.
//
// Rollback: if the app_users insert fails after the auth user has been
// created, delete the auth user so the operator can retry without
// orphaning rows in auth.users.
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { clientIp, handleRouteError, jsonError, jsonOk, parseJson } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const InviteInput = z.object({
  email: z.string().email().max(254),
  full_name: z.string().min(1).max(120),
  role: z.enum(["doctor", "staff", "admin"]),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole("admin");
    const input = await parseJson(req, InviteInput);
    const admin = getSupabaseAdmin();

    // Look up the role uuid; the FK is by id, not name.
    const { data: roleRow, error: roleErr } = await admin
      .from("roles")
      .select("id")
      .eq("name", input.role)
      .maybeSingle();
    if (roleErr || !roleRow) return jsonError(500, "role_lookup_failed", roleErr?.message);

    // Reject if an app_users row already exists for this email — keeps
    // (email, app_users) 1-to-1 and avoids a confusing "invite sent" UX
    // when the user already has access.
    const { data: existing } = await admin
      .from("app_users")
      .select("id")
      .eq("email", input.email)
      .maybeSingle();
    if (existing) return jsonError(409, "user_exists", "A user with that email already exists.");

    // Send the invite. Supabase emails the confirmation link; the link
    // points at the project's configured Site URL + /auth/callback.
    const { data: created, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(input.email);
    if (inviteErr || !created?.user) {
      return jsonError(500, "invite_failed", inviteErr?.message);
    }
    const newUserId = created.user.id;

    // Insert the app_users row mirroring the auth user.
    const { error: insErr } = await admin
      .from("app_users")
      .insert({
        id: newUserId,
        email: input.email,
        full_name: input.full_name,
        role_id: roleRow.id,
        status: "active",
        created_by: session.userId,
        updated_by: session.userId,
      });
    if (insErr) {
      // Rollback the auth user so the operator can retry.
      await admin.auth.admin.deleteUser(newUserId).catch(() => { /* best-effort */ });
      return jsonError(500, "user_create_failed", insErr.message);
    }

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "user_create",
      entityType: "app_users",
      entityId: newUserId,
      metadata: { email: input.email, role: input.role },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ id: newUserId }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
