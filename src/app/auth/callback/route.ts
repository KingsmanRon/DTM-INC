// PKCE auth callback. Email links from Supabase (magic-link, password
// recovery, email confirmation) all funnel through here:
//
//   1. Supabase verifies the token and redirects to this route with `?code`.
//   2. exchangeCodeForSession() trades the code for a session and writes
//      the auth cookies via the SSR client.
//   3. We redirect to `?next` (or a sensible default) so the user lands on
//      a page that already has a valid session.
//
// Without this handler, the magic-link / recovery URL lands on a page that
// never gets a session cookie and the (authed) layout bounces back to /login.
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServer, getSupabaseAdmin } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { writeAudit } from "@/lib/audit/log";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  // Recovery emails should land on the password-reset form even when the
  // caller didn't pass an explicit ?next. INVITES land there too: an invited
  // user has no password yet — sending them straight to /dashboard left them
  // with a session but no credential for next time. /reset-password handles
  // both ("Set a new password", then sign out → /login). Magic links default
  // to /dashboard.
  const type = url.searchParams.get("type");
  const fallback = type === "recovery" || type === "invite" ? "/reset-password" : "/dashboard";
  const next = safeRedirectPath(url.searchParams.get("next"), fallback);

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", req.url));
  }

  const supabase = await getSupabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, req.url)
    );
  }

  // Invite acceptance: an invited user's app_users row is created as
  // pending_invite (see /api/v1/admin/users/invite). Their first verified
  // arrival here IS the acceptance — flip to active so resolveSession lets
  // them in, and audit the transition. Recovery/magic links for existing
  // active users skip this (status is already active).
  const userId = data?.user?.id;
  if (userId) {
    const admin = getSupabaseAdmin();
    const { data: activated } = await admin
      .from("app_users")
      .update({ status: "active", updated_by: userId })
      .eq("id", userId)
      .eq("status", "pending_invite")
      .select("id, email")
      .maybeSingle();
    if (activated) {
      await writeAudit({
        actorUserId: userId,
        actorRole: null,
        action: "permission_change",
        entityType: "app_users",
        entityId: userId,
        metadata: { email: activated.email, transition: "invite_accepted" },
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: req.headers.get("user-agent"),
      });
    }
  }

  return NextResponse.redirect(new URL(next, req.url));
}
