// Supabase server client — bound to the caller's session cookie. This is the
// client you use in Route Handlers and Server Components to run queries
// **under the user's RLS context**. That is intentional: we want RLS to do
// half the enforcement work.
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { PublicEnv } from "@/lib/env";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export async function getSupabaseServer() {
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
}

export { getSupabaseAdmin } from "@/lib/supabase/admin";
