import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { clientIp, handleRouteError, jsonError, jsonOk, parseJson } from "@/lib/api/http";
import { StageBatchPayload } from "@/lib/validation/billing";
import { monthInputToFirstDay } from "@/lib/billing/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/v1/billing/items — stage (or refresh) patient files into a
// hospital/month batch. The stage_billing_export_items RPC auto-populates File
// Number, Name, ID/Passport and Medical Aid Number from the patient record and
// upserts on (patient_id, hospital, export_month) so re-staging never
// duplicates a row. Doctor + staff.
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const payload = await parseJson(req, StageBatchPayload);
    const exportMonth = monthInputToFirstDay(payload.month);
    if (!exportMonth) return jsonError(422, "invalid_month", "A valid month (YYYY-MM) is required.");

    const supabase = await getSupabaseServer();

    const { data: stagedCount, error } = await supabase.rpc("stage_billing_export_items", {
      p_actor_user_id: session.userId,
      p_hospital: payload.hospital,
      p_export_month: exportMonth,
      p_patient_ids: payload.patient_ids,
    });
    if (error) return jsonError(500, "stage_failed", error.message);

    const { data: batch, error: batchErr } = await supabase
      .from("billing_export_items")
      .select(
        "id, patient_id, file_number, patient_name, id_number, id_type, medical_aid_number, payer_type, outgoing_date, returned_date, status, exported_at",
      )
      .eq("hospital", payload.hospital)
      .eq("export_month", exportMonth)
      .order("patient_name", { ascending: true });
    if (batchErr) return jsonError(500, "db_error", batchErr.message);

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "billing_export_item_update",
      entityType: "billing_export_items",
      metadata: {
        change: "stage",
        hospital: payload.hospital,
        export_month: exportMonth,
        requested_patient_ids: payload.patient_ids,
        staged_count: typeof stagedCount === "number" ? stagedCount : null,
      },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ staged_count: stagedCount ?? 0, batch });
  } catch (err) {
    return handleRouteError(err);
  }
}
