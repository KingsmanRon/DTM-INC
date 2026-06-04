// Supabase server client — bound to the caller's session cookie. This is the
// client you use in Route Handlers and Server Components to run queries
// **under the user's RLS context**. That is intentional: we want RLS to do
// half the enforcement work.
import { cache } from "react";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { PublicEnv } from "@/lib/env";
import { logSupabaseCall } from "@/lib/supabase/log";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

// Wrapped in React cache() so the client is created ONCE per request and shared
// across every call site (layout, page, resolveSession, resolveMfa, route
// handler). Previously each helper called this independently, spinning up a new
// client — and each client managed its own auth/token-refresh state. Sharing one
// per request keeps cookie handling consistent and avoids redundant setup.
export const getSupabaseServer = cache(async () => {
  logSupabaseCall({ caller: "getSupabaseServer", client: "server", action: "client.create" });
  const cookieStore = await cookies();
  return createServerClient(PublicEnv.supabaseUrl, PublicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component — middleware handles the refresh.
        }
      },
    },
  });
});

export { getSupabaseAdmin } from "@/lib/supabase/admin";
