// Supabase server client — bound to the caller's session cookie. This is the
// client you use in Route Handlers and Server Components to run queries
// **under the user's RLS context**. That is intentional: we want RLS to do
// half the enforcement work.
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getServerEnv, PublicEnv } from "@/lib/env";

export async function getSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(PublicEnv.supabaseUrl, PublicEnv.supabaseAnonKey, {
    cookies: {
      get: (name: string) => cookieStore.get(name)?.value,
      set: (name: string, value: string, options: CookieOptions) => {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Called from a Server Component — middleware handles refresh.
        }
      },
      remove: (name: string, options: CookieOptions) => {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch {
          // no-op in Server Component context
        }
      },
    },
  });
}

// Service-role client — bypasses RLS. Use ONLY for:
//   * audit writes (via a dedicated audit_writer pg role, not this client,
//     when SUPABASE_AUDIT_DB_URL is set)
//   * admin operations explicitly gated by a prior authorisation check
//   * break-glass clinical-notes access after a break_glass_requests row is
//     validated (§10.4)
// Never return rows from this client directly to a response without
// re-verifying the caller's authorisation first.
export function getSupabaseAdmin() {
  const env = getServerEnv();
  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "x-dtm-service-client": "true" } },
  });
}
