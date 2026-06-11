// POST /api/v1/auth/logout — server-side sign-out.
//
// Pairs with /api/v1/auth/login (review P0#3): sign-out used to be a pure
// browser call, so the audit enum's `logout` value was never written. This
// route signs out via the cookie-bound server client (clearing the auth
// cookies on the response) and records who ended their session.
//
// Scope is the Supabase default (global): every refresh token for the user is
// revoked, not just this device's — the right default for a practice where
// staff move between shared front-desk machines and tablets.
//
// Also the target of the idle-timeout auto-logout (FR-1), which sends
// reason: "idle" so the audit row distinguishes walk-aways from clicks.
import type { NextRequest } from "next/server";
import { resolveSession } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { clientIp, handleRouteError, jsonOk } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    // May be null (expired/cleared session) — signing out is still fine, we
    // just cannot attribute an audit row to anyone.
    const session = await resolveSession();

    const supabase = await getSupabaseServer();
    await supabase.auth.signOut();

    if (session) {
      let reason: string | null = null;
      try {
        const body = (await req.json()) as { reason?: string } | null;
        if (body && typeof body.reason === "string") reason = body.reason.slice(0, 40);
      } catch {
        /* no body — a plain logout */
      }
      await writeAudit({
        actorUserId: session.userId,
        actorRole: session.role,
        action: "logout",
        entityType: "app_users",
        entityId: session.userId,
        metadata: reason ? { reason } : undefined,
        ipAddress: clientIp(req),
        userAgent: req.headers.get("user-agent"),
      });
    }

    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
