import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit/log";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { clientIp, handleRouteError, jsonOk, parseJson } from "@/lib/api/http";

const SyncActionSchema = z.object({
  client_action_id: z.string().trim().min(1).max(128),
  type: z.enum(["appointment_create", "appointment_update", "appointment_check_in", "queue_start", "queue_complete"]),
  appointment_id: z.string().uuid().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

const SyncRequestSchema = z.object({ actions: z.array(SyncActionSchema).min(1).max(100) });

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const { actions } = await parseJson(req, SyncRequestSchema);
    const admin = getSupabaseAdmin();
    const outcomes: Array<Record<string, unknown>> = [];

    for (const action of actions) {
      const { data: existing } = await admin
        .from("offline_sync_actions")
        .select("id, status, result_json")
        .eq("client_action_id", action.client_action_id)
        .eq("actor_user_id", session.userId)
        .maybeSingle();

      if (existing) {
        outcomes.push({ client_action_id: action.client_action_id, status: "synced", result: existing.result_json });
        continue;
      }

      try {
        const { data: rpcData, error: rpcErr } = await admin.rpc("apply_offline_action", {
          p_actor_user_id: session.userId,
          p_actor_role: session.role,
          p_client_action_id: action.client_action_id,
          p_action_type: action.type,
          p_appointment_id: action.appointment_id ?? null,
          p_payload: action.payload,
        });

        if (rpcErr) {
          outcomes.push({ client_action_id: action.client_action_id, status: "failed", error: rpcErr.message });
          await writeAudit({ actorUserId: session.userId, actorRole: session.role, action: "sync_failed", entityType: "offline_action", entityId: action.client_action_id, metadata: { reason: rpcErr.message } });
          continue;
        }

        const outcome = (rpcData as { status?: string; result?: unknown; conflict?: unknown } | null) ?? null;
        if (outcome?.status === "conflict") {
          outcomes.push({ client_action_id: action.client_action_id, status: "conflict", conflict: outcome.conflict ?? null });
          await writeAudit({ actorUserId: session.userId, actorRole: session.role, action: "sync_conflict", entityType: "offline_action", entityId: action.client_action_id, metadata: { conflict: outcome.conflict ?? null } });
          continue;
        }

        outcomes.push({ client_action_id: action.client_action_id, status: "synced", result: outcome?.result ?? null });
        await writeAudit({ actorUserId: session.userId, actorRole: session.role, action: "sync_success", entityType: "offline_action", entityId: action.client_action_id, metadata: { action_type: action.type }, ipAddress: clientIp(req), userAgent: req.headers.get("user-agent") });
      } catch (actionErr) {
        outcomes.push({ client_action_id: action.client_action_id, status: "failed", error: actionErr instanceof Error ? actionErr.message : "unknown_error" });
      }
    }

    return jsonOk({ outcomes });
  } catch (err) {
    return handleRouteError(err);
  }
}
