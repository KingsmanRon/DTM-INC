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

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const { id } = await params;
    const supabase = await getSupabaseServer();

    const { data: bundle, error } = await getPatientBundle(supabase, id);

    if (error) return jsonError(500, "db_error", error.message);
    if (!bundle) return jsonError(404, "not_found");

    // POPIA access logging (review #22): reading a demographics bundle is an
    // access to special personal information, same as note_read/document_view.
    // Type-ahead search is deliberately not audited (volume, masked fields) —
    // the bundle read is the meaningful event.
    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "patient_view",
      entityType: "patient",
      entityId: id,
      patientId: id,
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    // Deliberately DO NOT include clinical_notes here. The doctor fetches
    // those from /clinical-notes, staff/admin receive 404 from that endpoint.
    return jsonOk(bundle);
  } catch (err) {
    return handleRouteError(err);
  }
}

// NOTE: `hospital` is intentionally NOT patchable. A patient's file number
// carries the hospital prefix it was allocated under; editing hospital inline
// silently broke the hospital↔prefix invariant the billing batch screen
// depends on. Moving a patient between hospitals is a deliberate operator
// action — see update_patient_bundle (0047), which rejects it with PT409.
const PatientPatch = z.object({
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

function rpcStatus(error: { code?: string } | null): number {
  if (error?.code === "PT404") return 404;
  if (error?.code === "PT409") return 409;
  if (error?.code === "42501") return 404; // forbidden masquerades as not-found (FR-2)
  if (error?.code === "22023") return 400;
  return 500;
}

// PATCH /api/v1/patients/:id — demographics edit.
//
// Delegates to the update_patient_bundle RPC (migration 0047) so the patient
// row and its sub-resources change in ONE transaction. The previous
// implementation updated five tables sequentially: a mid-sequence failure
// persisted the patient-row change, returned a 500, and skipped the audit row.
// Now it is all-or-nothing and the audit row matches reality.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const { id } = await params;
    const patch = await parseJson(req, PatientPatch);
    const supabase = await getSupabaseServer();

    const { responsible, medical_aid, contact, referral, ...patientPatch } = patch;

    const { data, error } = await supabase
      .rpc("update_patient_bundle", {
        p_patient_id: id,
        p_patient: Object.keys(patientPatch).length > 0 ? patientPatch : null,
        p_responsible: responsible ?? null,
        p_medical_aid: medical_aid ?? null,
        p_contact: contact ?? null,
        p_referral: referral ?? null,
      })
      .maybeSingle();
    if (error) {
      const code =
        error.code === "PT404" ? "not_found"
        : error.code === "PT409" ? "invalid_change"
        : error.code === "22023" ? "invalid_request"
        : "db_error";
      return jsonError(rpcStatus(error), code, error.message);
    }
    if (!data) return jsonError(404, "not_found");

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
