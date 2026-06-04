import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api/http";
import { BillingHospital, BillingMonth } from "@/lib/validation/billing";
import { assemblePatientName, monthInputToFirstDay, monthLabel } from "@/lib/billing/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MedicalAidEmbed = { membership_number: string | null } | { membership_number: string | null }[] | null;

function membershipNumber(value: MedicalAidEmbed): string | null {
  if (Array.isArray(value)) return value[0]?.membership_number ?? null;
  return value?.membership_number ?? null;
}

// GET /api/v1/billing/candidates?hospital=...&month=YYYY-MM
// Returns the active patients for a hospital (the candidate pool staff curate
// from) plus the rows already staged in that hospital/month batch. Doctor + staff.
export async function GET(req: NextRequest) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    void session;

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

    const [patientsRes, batchRes] = await Promise.all([
      supabase
        .from("patients")
        .select("id, file_number, first_names, surname, id_number, id_type, patient_medical_aid(membership_number)")
        .eq("hospital", hospital)
        .eq("status", "active")
        .order("surname", { ascending: true })
        .order("first_names", { ascending: true }),
      supabase
        .from("billing_export_items")
        .select(
          "id, patient_id, file_number, patient_name, id_number, id_type, medical_aid_number, outgoing_date, returned_date, status, exported_at",
        )
        .eq("hospital", hospital)
        .eq("export_month", exportMonth)
        .order("patient_name", { ascending: true }),
    ]);

    if (patientsRes.error) return jsonError(500, "db_error", patientsRes.error.message);
    if (batchRes.error) return jsonError(500, "db_error", batchRes.error.message);

    const batch = batchRes.data ?? [];
    const stagedPatientIds = new Set(batch.map((b) => b.patient_id as string));

    const candidates = (patientsRes.data ?? []).map((p) => ({
      patient_id: p.id as string,
      file_number: (p.file_number as string | null) ?? null,
      name: assemblePatientName(p.first_names as string | null, p.surname as string | null),
      id_number: (p.id_number as string | null) ?? null,
      id_type: (p.id_type as string | null) ?? null,
      medical_aid_number: membershipNumber(p.patient_medical_aid as MedicalAidEmbed),
      in_batch: stagedPatientIds.has(p.id as string),
    }));

    return jsonOk({
      hospital,
      month,
      export_month: exportMonth,
      month_label: monthLabel(month),
      candidates,
      batch,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
