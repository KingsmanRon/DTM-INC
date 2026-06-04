// IMPORT GUARD: this module must never reach a browser bundle. The `server-only`
// import makes Next.js fail the build if a Client Component imports it (directly
// or transitively). The runtime check below is defence-in-depth, and
// admin.guard.test.ts statically asserts no `"use client"` file imports it.
import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";
import { logSupabaseCall } from "@/lib/supabase/log";

// Service-role client — bypasses RLS. Server-only by design. Use ONLY in narrow
// server-only functions (audit-log writes, privileged admin/break-glass work).
// Normal application reads must use the user/session client (getSupabaseServer).
export function getSupabaseAdmin() {
  if (typeof window !== "undefined") {
    throw new Error(
      "getSupabaseAdmin() must never run in the browser — the service-role key bypasses RLS."
    );
  }
  logSupabaseCall({ caller: "getSupabaseAdmin", client: "admin", action: "client.create" });
  const env = getServerEnv();
  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "x-dtm-service-client": "true" } },
  });
}
