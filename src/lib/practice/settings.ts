import "server-only";
import { getSupabaseServer } from "@/lib/supabase/server";
import { logSupabaseCall } from "@/lib/supabase/log";

// practice_settings is a single global row (id = 1) for this single-practice EHR
// and is readable by every authenticated user (RLS: practice_settings_read
// `using (true)`). It was previously re-read on EVERY authed render — the layout
// header/footer plus the admin settings page each issued their own
// `select * from practice_settings`, so navigation and RSC prefetch turned it
// into a steady stream of /rest/v1/practice_settings calls.
//
// This module fetches it ONCE and shares it:
//   * within a request: concurrent callers await the same in-flight promise;
//   * across requests: a short TTL memo (per warm serverless instance) means at
//     most one read per TTL window instead of one per render.
// The value is identical for all users, so cross-user sharing is correct. It is
// read with the user/session client (never the service-role client).

export type PracticeSettings = Record<string, unknown> | null;

const TTL_MS = 60_000;

let memo: { promise: Promise<PracticeSettings>; expiresAt: number } | null = null;

async function readPracticeSettings(): Promise<PracticeSettings> {
  const supabase = await getSupabaseServer();
  logSupabaseCall({ caller: "getPracticeSettings", client: "server", action: "select", target: "practice_settings" });
  const { data } = await supabase
    .from("practice_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  return (data as PracticeSettings) ?? null;
}

export function getPracticeSettings(): Promise<PracticeSettings> {
  const now = Date.now();
  if (memo && memo.expiresAt > now) return memo.promise;

  const promise = readPracticeSettings().catch((err) => {
    // Never cache a failure: drop the memo so the next caller retries.
    if (memo?.promise === promise) memo = null;
    throw err;
  });
  memo = { promise, expiresAt: now + TTL_MS };
  return promise;
}

// Clear the memo after a write so the change is visible immediately on the
// instance that handled the PATCH. Other warm instances pick it up within the
// TTL window above.
export function invalidatePracticeSettings(): void {
  memo = null;
}
