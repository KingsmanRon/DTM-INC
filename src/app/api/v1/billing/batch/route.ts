import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api/http";
import { BillingHospital, BillingMonth } from "@/lib/validation/billing";
import { isActiveHospital } from "@/lib/hospitals";
import { monthInputToFirstDay, monthLabel } from "@/lib/billing/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/billing/batch?hospital=...&month=YYYY-MM
// Returns only the rows already staged in a hospital/month batch — a bounded
// set loaded once per hospital/month. Candidate *finding* reuses the shared,
// indexed /api/v1/patients/search endpoint (scoped by the hospital's
// file-number prefix), so the full ~150-patient roster is never eager-loaded.
export async function GET(req: NextRequest) {
  try {
    await requireRole(["doctor", "staff"]);

    const url = new URL(req.url);
    const hospitalParsed = BillingHospital.safeParse(url.searchParams.get("hospital"));
    const monthParsed = BillingMonth.safeParse(url.searchParams.get("month"));
    if (!hospitalParsed.success) return jsonError(422, "invalid_hospital", "A valid hospital is required.");
    if (!monthParsed.success) return jsonError(422, "invalid_month", "A valid month (YYYY-MM) is required.");

    const hospital = hospitalParsed.data;
    const month = monthParsed.data;
    const exportMonth = monthInputToFirstDay(month);
    if (!exportMonth) return jsonError(422, "invalid_month", "A valid month (YYYY-MM) is required.");

    const supabase = await getSupabaseServer();
    // Hospitals are data (0044), not an enum — validate against the table.
    if (!(await isActiveHospital(supabase, hospital))) {
      return jsonError(422, "invalid_hospital", "A valid hospital is required.");
    }
    const { data: batch, error } = await supabase
      .from("billing_export_items")
      .select(
        "id, patient_id, file_number, patient_name, id_number, id_type, medical_aid_number, payer_type, outgoing_date, returned_date, status, exported_at",
      )
      .eq("hospital", hospital)
      .eq("export_month", exportMonth)
      .order("patient_name", { ascending: true });
    if (error) return jsonError(500, "db_error", error.message);

    return jsonOk({
      hospital,
      month,
      export_month: exportMonth,
      month_label: monthLabel(month),
      batch: batch ?? [],
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
