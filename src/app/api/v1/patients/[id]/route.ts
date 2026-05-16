import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { TitleEnum, PayerType, HospitalEnum } from "@/lib/validation/patient";
import { clientIp, handleRouteError, jsonError, jsonOk, parseJson } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const { id } = await params;
    const supabase = await getSupabaseServer();

    const [patient, responsible, medicalAid, contacts, referral, dependants] = await Promise.all([
      supabase.from("patients").select("*").eq("id", id).single(),
      supabase.from("patient_account_responsible").select("*").eq("patient_id", id).maybeSingle(),
      supabase.from("patient_medical_aid").select("*").eq("patient_id", id).maybeSingle(),
      supabase.from("patient_emergency_contacts").select("*").eq("patient_id", id),
      supabase.from("patient_referrals").select("*").eq("patient_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("patient_dependants").select("*").eq("patient_id", id).is("archived_at", null),
    ]);

    if (patient.error || !patient.data) return jsonError(404, "not_found");

    // Deliberately DO NOT include clinical_notes here. The doctor fetches
    // those from /clinical-notes, staff/admin receive 404 from that endpoint.
    void session;
    return jsonOk({
      patient: patient.data,
      responsible: responsible.data,
      medical_aid: medicalAid.data,
      contacts: contacts.data ?? [],
      referral: referral.data,
      dependants: dependants.data ?? [],
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

const PatientPatch = z.object({
  hospital: HospitalEnum.optional(),
  title: TitleEnum.optional(),
  first_names: z.string().min(1).optional(),
  surname: z.string().min(1).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().min(7).optional(),
  address: z.string().min(1).optional(),
  payer_type: PayerType.optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const { id } = await params;
    const patch = await parseJson(req, PatientPatch);
    const supabase = await getSupabaseServer();

    const { data, error } = await supabase
      .from("patients")
      .update({ ...patch, updated_by: session.userId })
      .eq("id", id)
      .select()
      .single();
    if (error) return jsonError(500, "db_error", error.message);

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "patient_update",
      entityType: "patient",
      entityId: id,
      patientId: id,
      metadata: { changed_fields: Object.keys(patch) },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ patient: data });
  } catch (err) {
    return handleRouteError(err);
  }
}
