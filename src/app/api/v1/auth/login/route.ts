// POST /api/v1/auth/login — server-side sign-in.
//
// WHY THIS EXISTS (review P0#3): sign-in used to happen entirely in the browser
// (supabase.auth.signInWithPassword from login/page.tsx), so the audit enum's
// login_success / login_failure / login_lockout values were never written,
// app_users.last_login_at stayed NULL forever, and the failed_login_count /
// locked_until columns were dead. Authentication events are the first thing a
// POPIA investigation asks for — they must be server-recorded, not client-
// optional. Routing the credential exchange through this handler gives the app:
//
//   * a hash-chained audit row for every success, failure, and lockout;
//   * last_login_at for the admin Users screen;
//   * an app-level lockout: 5 consecutive failures locks the account for
//     15 minutes (Supabase's own rate limits still apply underneath).
//
// The @supabase/ssr server client is cookie-bound and route handlers CAN write
// cookies, so a successful sign-in here sets the same auth cookies the browser
// flow used to; the browser Supabase client reads those cookies for the MFA
// enrol/challenge pages unchanged.
//
// Account-enumeration trade-off: failure responses are a generic
// invalid_credentials EXCEPT an active lockout, which says so explicitly. This
// is an internal staff system — telling a locked-out receptionist why they
// cannot get in beats strict enumeration hygiene.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { clientIp, handleRouteError, jsonError, jsonOk, parseJson } from "@/lib/api/http";
import {
  APP_PROFILE_SELECT,
  getProfileFailureReason,
  profileFailureMessage,
  profileFromQueryRow,
  sessionFromProfile,
  type AppProfileQueryRow,
  type AppRole,
} from "@/lib/auth/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

const LoginInput = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

type KnownAccount = {
  id: string;
  status: string;
  failed_login_count: number;
  locked_until: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const input = await parseJson(req, LoginInput);
    const email = input.email.trim();
    const ip = clientIp(req);
    const userAgent = req.headers.get("user-agent");

    const admin = getSupabaseAdmin();

    // ilike with no wildcards = case-insensitive equality, so a differently-
    // cased sign-in still maps onto the right lockout counters.
    const { data: account } = await admin
      .from("app_users")
      .select("id, status, failed_login_count, locked_until")
      .ilike("email", email)
      .maybeSingle<KnownAccount>();

    // Active lockout: refuse before touching Supabase Auth, so a locked
    // account cannot keep burning password guesses.
    if (account?.locked_until && new Date(account.locked_until).getTime() > Date.now()) {
      const minutesLeft = Math.max(
        1,
        Math.ceil((new Date(account.locked_until).getTime() - Date.now()) / 60_000)
      );
      await writeAudit({
        actorUserId: account.id,
        actorRole: null,
        action: "login_failure",
        entityType: "app_users",
        entityId: account.id,
        metadata: { email, reason: "locked_out", minutes_left: minutesLeft },
        ipAddress: ip,
        userAgent,
      });
      return jsonError(
        401,
        "account_locked",
        `Too many failed sign-in attempts. Try again in about ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.`
      );
    }

    const supabase = await getSupabaseServer();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: input.password });

    if (error || !data.session || !data.user) {
      if (account) {
        const failed = (account.failed_login_count ?? 0) + 1;
        const lockout = failed >= MAX_FAILED_ATTEMPTS;
        await admin
          .from("app_users")
          .update({
            failed_login_count: failed,
            ...(lockout
              ? { locked_until: new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString() }
              : {}),
          })
          .eq("id", account.id);
        await writeAudit({
          actorUserId: account.id,
          actorRole: null,
          action: lockout ? "login_lockout" : "login_failure",
          entityType: "app_users",
          entityId: account.id,
          metadata: lockout
            ? { email, failed_attempts: failed, locked_minutes: LOCKOUT_MINUTES }
            : { email, failed_attempts: failed, reason: "bad_credentials" },
          ipAddress: ip,
          userAgent,
        });
      } else {
        await writeAudit({
          actorUserId: null,
          actorRole: null,
          action: "login_failure",
          metadata: { email, reason: "unknown_account_or_bad_credentials" },
          ipAddress: ip,
          userAgent,
        });
      }
      return jsonError(401, "invalid_credentials", "Invalid email or password.");
    }

    // Credentials are good — validate the STAFF PROFILE before letting the
    // session stand (same checks the old client-side flow performed, now
    // server-recorded). The cookie-bound client now carries the new session,
    // so this select runs under the user's own RLS self-read policy.
    const { data: profileRow, error: profileErr } = await supabase
      .from("app_users")
      .select(APP_PROFILE_SELECT)
      .eq("id", data.user.id)
      .maybeSingle();

    const profile = profileFromQueryRow((profileRow as AppProfileQueryRow | null) ?? null);
    const failureReason = profileErr ? null : getProfileFailureReason(profile);
    const session = sessionFromProfile(profile);

    if (profileErr || failureReason || !session) {
      await supabase.auth.signOut();
      await writeAudit({
        actorUserId: data.user.id,
        actorRole: null,
        action: "login_failure",
        entityType: "app_users",
        entityId: data.user.id,
        metadata: { email, reason: profileErr ? "profile_lookup_failed" : `profile_${failureReason}` },
        ipAddress: ip,
        userAgent,
      });
      // Password was correct: this is a profile problem, not a guess — it does
      // not advance the lockout counter, and the message is specific on purpose.
      return jsonError(
        403,
        profileErr ? "profile_unavailable" : `profile_${failureReason}`,
        profileErr
          ? "Sign-in succeeded, but the staff profile service is unavailable. Please try again or contact admin."
          : profileFailureMessage(failureReason ?? "missing")
      );
    }

    await admin
      .from("app_users")
      .update({ failed_login_count: 0, locked_until: null, last_login_at: new Date().toISOString() })
      .eq("id", session.userId);

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role as AppRole,
      action: "login_success",
      entityType: "app_users",
      entityId: session.userId,
      metadata: { email },
      ipAddress: ip,
      userAgent,
    });

    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
