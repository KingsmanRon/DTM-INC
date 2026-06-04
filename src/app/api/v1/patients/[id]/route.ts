import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { getPatientBundle } from "@/lib/patients/bundle";
import { TitleEnum, PayerType } from "@/lib/validation/patient";
import { clientIp, handleRouteError, jsonError, jsonOk, parseJson } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const { id } = await params;
    const supabase = await getSupabaseServer();

    const { data: bundle, error } = await getPatientBundle(supabase, id);

    if (error) return jsonError(500, "db_error", error.message);
    if (!bundle) return jsonError(404, "not_found");

    // Deliberately DO NOT include clinical_notes here. The doctor fetches
    // those from /clinical-notes, staff/admin receive 404 from that endpoint.
    void session;
    return jsonOk(bundle);
  } catch (err) {
    return handleRouteError(err);
  }
}

const PatientPatch = z.object({
  hospital: z.string().optional(),
  title: TitleEnum.optional(),
  first_names: z.string().min(1).optional(),
  surname: z.string().min(1).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().min(7).optional(),
  address: z.string().min(1).optional(),
  payer_type: PayerType.optional(),
  responsible: z.object({
    first_names: z.string().min(1),
    surname: z.string().min(1),
    phone: z.string().min(7),
    employer_name: z.string().nullable(),
    occupation: z.string().nullable(),
  }).optional(),
  medical_aid: z.object({
    main_member_name: z.string().nullable(),
    medical_aid_name: z.string().nullable(),
    membership_number: z.string().nullable(),
    plan: z.string().nullable(),
  }).optional(),
  contact: z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(1),
    relationship: z.string().min(1),
    phone: z.string().min(7),
  }).optional(),
  referral: z.object({
    id: z.string().uuid().optional(),
    referrer_type: z.enum(["gp", "specialist", "hospital", "self", "other"]),
    referrer_name: z.string().nullable(),
    referrer_phone: z.string().nullable(),
  }).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const { id } = await params;
    const patch = await parseJson(req, PatientPatch);
    const supabase = await getSupabaseServer();

    const { responsible, medical_aid, contact, referral, ...patientPatch } = patch;

    const { data, error } = await supabase
      .from("patients")
      .update({ ...patientPatch, updated_by: session.userId })
      .eq("id", id)
      .select()
      .single();
    if (error) return jsonError(500, "db_error", error.message);

    if (responsible) {
      const { error: rError } = await supabase
        .from("patient_account_responsible")
        .update({ ...responsible, updated_by: session.userId })
        .eq("patient_id", id);
      if (rError) return jsonError(500, "db_error", rError.message);
    }

    if (medical_aid) {
      const { error: mError } = await supabase
        .from("patient_medical_aid")
        .update({ ...medical_aid, updated_by: session.userId })
        .eq("patient_id", id);
      if (mError) return jsonError(500, "db_error", mError.message);
    }

    if (contact) {
      let q = supabase
        .from("patient_emergency_contacts")
        .update({
          name: contact.name,
          relationship: contact.relationship,
          phone: contact.phone,
          updated_by: session.userId,
        })
        .eq("patient_id", id);
      if (contact.id) q = q.eq("id", contact.id);
      const { error: cError } = await q;
      if (cError) return jsonError(500, "db_error", cError.message);
    }

    if (referral) {
      let q = supabase
        .from("patient_referrals")
        .update({
          referrer_type: referral.referrer_type,
          referrer_name: referral.referrer_name,
          referrer_phone: referral.referrer_phone,
          updated_by: session.userId,
        })
        .eq("patient_id", id);
      if (referral.id) q = q.eq("id", referral.id);
      const { error: refError } = await q;
      if (refError) return jsonError(500, "db_error", refError.message);
    }

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
