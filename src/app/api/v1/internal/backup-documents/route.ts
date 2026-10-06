// Nightly off-site document backup. Called by Vercel Cron (vercel.json) with
// `Authorization: Bearer <CRON_SECRET>`, like the audit-chain jobs.
//
// Each run copies documents not yet in the S3 backup within a time budget and
// reports what remains; a large first backlog is cleared over several nights
// or at once with `npm run docs:backup`. A run with any document not backed up
// returns 500 so it shows as failed in the Vercel cron log.
import type { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api/http";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { backupTargetFromEnv } from "@/lib/backup/s3";
import { runDocumentBackup } from "@/lib/backup/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 60s is allowed on every Vercel plan, with or without Fluid compute; the
// platform default without Fluid (10-15s) would cut a run off mid-batch.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return jsonError(500, "cron_secret_unset");
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${expected}`) return jsonError(401, "unauthorised");

  const target = backupTargetFromEnv();
  if (!target) {
    return jsonError(503, "backup_not_configured", "Set BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY.");
  }

  // Leave time inside maxDuration for the final count and response. Larger
  // backlogs clear over successive runs or with `npm run docs:backup`.
  const budgetSeconds = Math.min(Math.max(Number(process.env.BACKUP_TIME_BUDGET_SECONDS) || 45, 5), 50);
  const summary = await runDocumentBackup(getSupabaseAdmin(), target, { timeBudgetMs: budgetSeconds * 1000 });
  // No lease means nothing ran: another run is active, or the lock row is
  // missing. Either way the cron log must not show a green run.
  if (!summary.acquired_lock) return jsonError(409, "backup_lock_unavailable");
  const problems = summary.missing_source + summary.hash_mismatch + summary.failed;
  const body = { ok: summary.acquired_lock && problems === 0, ...summary, ran_at: new Date().toISOString() };
  return problems > 0 ? jsonOk(body, { status: 500 }) : jsonOk(body);
}
