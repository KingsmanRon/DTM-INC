// Session refresh + route-level auth gate. The detailed role authorisation
// lives inside each Route Handler / Server Component (§10.1 layer 2); this
// middleware is only the first coarse filter.
//
// Safety properties (keep these true — every reviewer should be able to
// verify them from this file alone):
//
//   1. NO PHI IS READ OR DECRYPTED HERE. No patient, clinical-note, or
//      document table is queried. The only DB interaction is the Supabase
//      Auth getUser() call, which verifies the session JWT against the
//      Auth server and returns the user's auth identity (id, email, role
//      claims) — never patient data.
//
//   2. NO APPLICATION LOGGING. No console.log, no fetch()-to-telemetry.
//      Vercel's platform-level access logs still exist; those are the
//      processor's logs per POPIA s.21 and covered by Vercel's DPA. They
//      must NOT be relied on for the application audit trail — that
//      lives in the hash-chained audit_logs table (see §10.5).
//
//   3. getUser() — NOT getSession() — IS INTENTIONAL. getSession() reads
//      the JWT from the cookie without verification; a forged cookie would
//      pass. getUser() verifies the token against Supabase Auth, which is
//      the security-recommended pattern. The ~50ms round-trip is the
//      price of not trusting the cookie. Do not "optimise" this to
//      getSession().
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

const PUBLIC_PATHS = new Set<string>([
  "/", "/login", "/forgot-password", "/reset-password", "/privacy", "/health",
]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Internal cron/maintenance endpoints authenticate via CRON_SECRET inside the
  // handler, not via a user session. Vercel Cron sends `Authorization: Bearer
  // <CRON_SECRET>` and NO session cookie, so this middleware's getUser() gate
  // would 401 them before the handler's secret check ever runs. Let them
  // through; each handler enforces CRON_SECRET itself (401 without it).
  if (pathname.startsWith("/api/v1/internal/")) return true;
  // /mfa/* requires AAL1 but not AAL2 — handled inside the page, not here.
  if (pathname.startsWith("/mfa/")) return false;
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next({ request: { headers: req.headers } });

  const res = NextResponse.next({ request: { headers: req.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Coarse protected-route validation. Keep getUser() for now: this project
  // currently depends on Supabase Auth server validation/session refresh here,
  // and @supabase/supabase-js in package.json predates a clearly-supported
  // getClaims() path for local JWKS verification in middleware. Do not replace
  // this with getSession(), which trusts cookie contents.
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    // API calls get a 401 so the client can handle it; pages redirect to /login.
    if (pathname.startsWith("/api/")) {
      return new NextResponse(JSON.stringify({ error: "unauthenticated" }), {
        status: 401,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return res;
}

export const config = {
  // NOTE: /api/v1/* is intentionally NOT matched here. Every /api/v1 handler
  // already performs the authoritative server-side verification itself —
  // requireRole()/requireSession() -> resolveSession() -> auth.getUser() — and
  // returns 401/404 on failure (internal cron routes verify CRON_SECRET). Running
  // getUser() in middleware too meant TWO /auth/v1/user calls per API request.
  // Excluding API routes here drops it to one (in the handler, where the verified
  // user is actually needed for the RLS-bound query + role lookup). The handler's
  // Supabase client still refreshes and writes session cookies on the response,
  // so token rotation is unaffected. Page routes stay matched: Server Components
  // cannot set cookies, so middleware remains the place that refreshes the
  // browser session on navigation. The /api/* branches above are retained as
  // defensive behaviour in case this matcher is ever broadened again.
  matcher: [
    "/dashboard/:path*",
    "/patients/:path*",
    "/admin/:path*",
    "/mfa/:path*",
  ],
};
