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
import { getSupabaseServer } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/auth/redirect";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  // Recovery emails should land on the password-reset form even when the
  // caller didn't pass an explicit ?next. Magic links default to /dashboard.
  const type = url.searchParams.get("type");
  const fallback = type === "recovery" ? "/reset-password" : "/dashboard";
  const next = safeRedirectPath(url.searchParams.get("next"), fallback);

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", req.url));
  }

  const supabase = await getSupabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, req.url)
    );
  }

  return NextResponse.redirect(new URL(next, req.url));
}
