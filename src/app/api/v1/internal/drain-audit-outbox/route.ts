// Audit-outbox drainer. Called by Vercel Cron (vercel.json). Vercel injects
// `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set in env.
//
// Why a cron and not opportunistic draining:
//   The outbox holds audit events that failed their synchronous write. Earlier
//   versions drained it from inside request handlers, which fanned out
//   service_role REST calls across every serverless instance (module-level
//   rate-limiting resets on each cold start) and exhausted the database CPU
//   credits. Draining now happens in this single, lease-guarded context only.
//
// Security: this endpoint bypasses the normal session/role gate because it is
// called by Vercel's cron infrastructure, not a user. The shared-secret check
// is the authorisation, identical to the chain verifier.
import type { NextRequest } from "next/server";
import { drainAuditOutbox } from "@/lib/audit/log";
import { jsonError, jsonOk } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return jsonError(500, "cron_secret_unset");

  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) return jsonError(401, "unauthorised");

  const summary = await drainAuditOutbox();
  return jsonOk({ ok: true, ...summary, drained_at: new Date().toISOString() });
}
