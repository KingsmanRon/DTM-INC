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
  // /mfa/* requires AAL1 but not AAL2 — handled inside the page, not here.
  if (pathname.startsWith("/mfa/")) return false;
  return pathname.startsWith("/_next") || pathname.startsWith("/brand") ||
         pathname.startsWith("/icons") || pathname === "/favicon.ico" ||
         pathname === "/manifest.webmanifest" || pathname === "/sw.js";
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

  // Refresh the session if expired. Swallow errors — authorisation happens later.
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons|brand|manifest.webmanifest|sw.js).*)"],
};
