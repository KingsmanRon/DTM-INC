"use client";

import { createBrowserClient } from "@supabase/ssr";
import { PublicEnv } from "@/lib/env";

// Browser client — used only for auth UI (login, password reset, MFA).
// Never used to fetch patient data directly. All data flows through /api.
export function getSupabaseBrowser() {
  return createBrowserClient(PublicEnv.supabaseUrl, PublicEnv.supabaseAnonKey, {
    auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true },
  });
}
