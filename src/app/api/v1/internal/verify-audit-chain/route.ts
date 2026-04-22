// Audit-chain verifier endpoint. Called by Vercel Cron daily at 02:00 UTC
// (vercel.json). Vercel injects `Authorization: Bearer <CRON_SECRET>` when
// CRON_SECRET is set in env.
//
// Security: this endpoint bypasses the normal session/role gate because it
// is called by Vercel's cron infrastructure, not a user. The shared-secret
// check is the authorisation.
//
// Alerting: on `{ ok: false }`, throw so Vercel marks the cron run as
// failed — that surfaces in the Vercel dashboard and in Sentry if wired.
import type { NextRequest } from "next/server";
import { verifyChain } from "@/lib/audit/log";
import { jsonError, jsonOk } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return jsonError(500, "cron_secret_unset");

  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) return jsonError(401, "unauthorised");

  const result = await verifyChain();
  if (!result.ok) {
    // Surface as a 500 so Vercel reports a failed invocation.
    console.error("[audit-chain] BROKEN at", result.brokenAt);
    return jsonError(500, "audit_chain_broken", result.brokenAt);
  }
  return jsonOk({ ok: true, checked_at: new Date().toISOString() });
}
