import "server-only";

// TEMPORARY DIAGNOSTIC INSTRUMENTATION.
//
// Emits one structured line immediately before each server-side Supabase
// REST / RPC / Auth call so the source of excessive PostgREST `set_config`
// traffic (and repeated /auth/v1/user hits) can be attributed to a caller,
// route, table/RPC and client type. Off by default; enable with
// `SUPABASE_CALL_DEBUG=true` while diagnosing, then unset it again.
//
// This is intentionally NOT wired into src/middleware.ts: that file documents a
// hard "no application logging" invariant (POPIA §21) and must stay log-free.

export type SupabaseClientType = "server" | "admin" | "browser";

export type SupabaseCallAction =
  | "auth.getUser"
  | "auth.getSession"
  | "auth.mfa"
  | "select"
  | "insert"
  | "update"
  | "rpc"
  | "client.create";

export type SupabaseCallMeta = {
  caller: string;
  client: SupabaseClientType;
  action: SupabaseCallAction;
  target?: string; // table name, rpc name, or auth endpoint
  route?: string | null;
};

function enabled(): boolean {
  return process.env.SUPABASE_CALL_DEBUG === "true";
}

export function logSupabaseCall(meta: SupabaseCallMeta): void {
  if (!enabled()) return;
  // eslint-disable-next-line no-console
  console.info("[supabase-call]", {
    ts: new Date().toISOString(),
    caller: meta.caller,
    client: meta.client,
    action: meta.action,
    target: meta.target ?? null,
    route: meta.route ?? null,
  });
}
