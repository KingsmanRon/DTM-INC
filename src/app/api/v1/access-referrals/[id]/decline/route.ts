// POST /api/v1/access-referrals/:id/decline — decline an ACCESS referral with
// a reason. Doctor + staff. Handled by the decline_access_referral RPC (0063).
import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { clientIp, handleRouteError, jsonError, jsonOk, parseJson } from "@/lib/api/http";
import { DeclineAccessReferralPayload } from "@/lib/validation/access-referrals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rpcStatus(code: string | undefined): number {
  if (code === "PT404") return 404;
  if (code === "PT409") return 409;
  if (code === "42501") return 404; // forbidden masquerades as not-found (FR-2)
  if (code === "22023") return 422;
  return 500;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const { id } = await params;
    const input = await parseJson(req, DeclineAccessReferralPayload);

    const supabase = await getSupabaseServer();
    const { data, error } = await supabase
      .rpc("decline_access_referral", { p_inbox_id: id, p_reason: input.reason })
      .maybeSingle();

    if (error || !data) {
      const code = error?.code === "PT409" ? "already_resolved" : error?.code === "PT404" ? "not_found" : "decline_failed";
      const message =
        error?.code === "PT409"
          ? "This referral was already handled."
          : error?.code === "PT404"
            ? "That referral could not be found."
            : "The referral could not be declined. Please try again.";
      return jsonError(rpcStatus(error?.code), code, message);
    }

    const { reference } = data as { reference: string };
    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "access_referral_declined",
      entityType: "access_referral_inbox",
      entityId: id,
      // The reason stays on the inbox row: free text, and admin reads the audit
      // log but not the inbox.
      metadata: { reference },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ ok: true, reference });
  } catch (err) {
    return handleRouteError(err);
  }
}
