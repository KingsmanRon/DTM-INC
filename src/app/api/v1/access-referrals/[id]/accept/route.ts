// POST /api/v1/access-referrals/:id/accept — link an ACCESS referral to an
// existing, active patient file. Doctor + staff. The accept_access_referral
// RPC (0063) records the referral on the patient and closes the inbox item in
// one transaction; a new patient is onboarded first (consent is in person).
import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { clientIp, handleRouteError, jsonError, jsonOk, parseJson } from "@/lib/api/http";
import { AcceptAccessReferralPayload } from "@/lib/validation/access-referrals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AcceptResult = { referral_id: string; patient_id: string; reference: string };

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
    const input = await parseJson(req, AcceptAccessReferralPayload);

    const supabase = await getSupabaseServer();
    const { data, error } = await supabase
      .rpc("accept_access_referral", {
        p_inbox_id: id,
        p_patient_id: input.patient_id,
        p_referrer_type: input.referrer_type,
      })
      .maybeSingle();

    if (error || !data) {
      const code =
        error?.code === "PT404" ? "not_found"
        : error?.code === "PT409" ? "already_resolved_or_archived"
        : error?.code === "22023" ? "invalid_request"
        : "accept_failed";
      const message =
        error?.code === "PT409"
          ? "This referral was already handled, or the patient file is archived."
          : error?.code === "PT404"
            ? "That referral or patient file could not be found."
            : "The referral could not be linked. Please try again.";
      return jsonError(rpcStatus(error?.code), code, message);
    }

    const result = data as AcceptResult;
    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "access_referral_accepted",
      entityType: "access_referral_inbox",
      entityId: id,
      patientId: result.patient_id,
      metadata: {
        reference: result.reference,
        patient_referral_id: result.referral_id,
        referrer_type: input.referrer_type,
      },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ ok: true, patient_id: result.patient_id, reference: result.reference });
  } catch (err) {
    return handleRouteError(err);
  }
}
