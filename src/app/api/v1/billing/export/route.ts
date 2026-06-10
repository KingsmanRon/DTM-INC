import type { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { clientIp, handleRouteError, jsonError, parseJson } from "@/lib/api/http";
import { GenerateExportPayload } from "@/lib/validation/billing";
import { billingFilename, monthInputToFirstDay, monthLabel } from "@/lib/billing/format";
import { buildBillingRows, type BillingItem } from "@/lib/billing/rows";
import { buildXlsx } from "@/lib/billing/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BatchRow = BillingItem & { id: string; patient_id: string };

const RECIPIENT = "third-party billing company";

// POST /api/v1/billing/export — generate the .xlsx for a hospital/month batch.
// Reads the already-staged rows (with ID/Passport + Medical Aid Number
// auto-populated), stamps the shared outgoing date, marks the batch exported,
// and records a POPIA disclosure audit naming which patients' identifiers left
// the practice and to whom. Doctor + staff.
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const payload = await parseJson(req, GenerateExportPayload);
    const exportMonth = monthInputToFirstDay(payload.month);
    if (!exportMonth) return jsonError(422, "invalid_month", "A valid month (YYYY-MM) is required.");

    const outgoingOverride = payload.outgoing_date && payload.outgoing_date !== "" ? payload.outgoing_date : null;

    const supabase = await getSupabaseServer();
    const { data: batch, error } = await supabase
      .from("billing_export_items")
      .select("id, patient_id, file_number, patient_name, id_number, medical_aid_number, payer_type, outgoing_date, returned_date")
      .eq("hospital", payload.hospital)
      .eq("export_month", exportMonth)
      .order("patient_name", { ascending: true });
    if (error) return jsonError(500, "db_error", error.message);
    if (!batch || batch.length === 0) {
      return jsonError(422, "empty_batch", "No files are staged in this hospital/month batch yet.");
    }

    const rows = batch as BatchRow[];

    // The outgoing date shown in the file: an explicit override (applied to the
    // whole batch) wins, otherwise each row's stored date.
    const items: BillingItem[] = rows.map((r) => ({
      file_number: r.file_number,
      patient_name: r.patient_name,
      id_number: r.id_number,
      medical_aid_number: r.medical_aid_number,
      payer_type: r.payer_type,
      outgoing_date: outgoingOverride ?? r.outgoing_date,
      returned_date: r.returned_date,
    }));

    const matrix = buildBillingRows(items);
    const xlsx = buildXlsx(`Billing ${monthLabel(payload.month)}`, matrix);
    const sha256 = createHash("sha256").update(xlsx).digest("hex");
    const filename = billingFilename(payload.hospital, payload.month);

    // Mark the batch exported (and stamp the shared outgoing date if overridden).
    const update: Record<string, string> = {
      status: "exported",
      exported_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      updated_by: session.userId,
    };
    if (outgoingOverride) update.outgoing_date = outgoingOverride;
    const { error: markErr } = await supabase
      .from("billing_export_items")
      .update(update)
      .eq("hospital", payload.hospital)
      .eq("export_month", exportMonth);
    if (markErr) {
      // The file is the deliverable and the disclosure audit below still records
      // it; a failed status stamp is not worth withholding the export.
      console.error("[billing] failed to mark batch exported", { error: markErr.message });
    }

    // POPIA disclosure record (Constraints §5): reconstructable — which
    // patients' identifiers were exported, and to whom.
    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "billing_export_generate",
      entityType: "billing_export_items",
      metadata: {
        hospital: payload.hospital,
        export_month: exportMonth,
        recipient: RECIPIENT,
        row_count: rows.length,
        cash_row_count: rows.filter((r) => r.payer_type === "private").length,
        outgoing_date: outgoingOverride,
        sha256,
        bytes: xlsx.length,
        filename,
        patient_ids: rows.map((r) => r.patient_id),
        file_numbers: rows.map((r) => r.file_number),
      },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return new Response(new Uint8Array(xlsx), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Content-SHA256": sha256,
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
