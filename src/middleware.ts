// Session refresh + route-level auth gate. The detailed role authorisation
// lives inside each Route Handler / Server Component (§10.1 layer 2); this
// middleware is only the first coarse filter.
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

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
  const res = NextResponse.next({ request: { headers: req.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Refresh the session if expired. Swallow errors — authorisation happens later.
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return res;

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
