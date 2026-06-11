// POST /api/v1/patients/:id/reassign-hospital — correct a patient filed under
// the wrong hospital (e.g. an NKA file that should be FOU).
//
// Delegates to the reassign_patient_hospital RPC (0053), which atomically:
// allocates a NEW file number under the correct prefix, retires the old number
// into patient_file_number_history + a reservations poison pill (old numbers
// are never reissued), and removes never-exported billing rows snapshotted
// under the wrong hospital. Search continues to resolve the old number.
//
// Doctor + staff, with a mandatory reason — this is the deliberate operator
// action the 0047 hospital-immutability rule points at.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { clientIp, handleRouteError, jsonError, jsonOk, parseJson } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ReassignInput = z.object({
  new_hospital: z.string().min(1, "Select the correct hospital."),
  reason: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(10, "A reason of at least 10 characters is required.").max(500)),
});

type ReassignResult = {
  old_file_number: string;
  new_file_number: string;
  old_hospital: string;
  new_hospital: string;
  removed_pending_billing: number;
};

function rpcStatus(error: { code?: string } | null): number {
  if (error?.code === "PT404") return 404;
  if (error?.code === "PT409") return 409;
  if (error?.code === "42501") return 404; // forbidden masquerades as not-found (FR-2)
  if (error?.code === "22023") return 422;
  return 500;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const { id } = await params;
    const input = await parseJson(req, ReassignInput);

    const supabase = await getSupabaseServer();
    const { data, error } = await supabase
      .rpc("reassign_patient_hospital", {
        p_patient_id: id,
        p_new_hospital: input.new_hospital,
        p_reason: input.reason,
      })
      .maybeSingle();

    if (error || !data) {
      const code =
        error?.code === "PT404" ? "not_found"
        : error?.code === "PT409" ? "already_at_hospital"
        : error?.code === "22023" ? "invalid_request"
        : "reassign_failed";
      return jsonError(rpcStatus(error ?? null), code, error?.message ?? "Reassignment failed.");
    }

    const result = data as ReassignResult;

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "patient_file_reassigned",
      entityType: "patient",
      entityId: id,
      patientId: id,
      metadata: {
        old_file_number: result.old_file_number,
        new_file_number: result.new_file_number,
        old_hospital: result.old_hospital,
        new_hospital: result.new_hospital,
        removed_pending_billing: result.removed_pending_billing,
        reason: input.reason,
      },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({
      old_file_number: result.old_file_number,
      new_file_number: result.new_file_number,
      new_hospital: result.new_hospital,
      removed_pending_billing: result.removed_pending_billing,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
