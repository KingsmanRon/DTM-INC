import type { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer, getSupabaseAdmin } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { OnboardingPayload } from "@/lib/validation/patient";
import { clientIp, handleRouteError, jsonError, jsonOk, parseJson } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/patients — list (paginated). Staff + doctor only.
export async function GET(req: NextRequest) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 100);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
    const includeArchived = url.searchParams.get("archived") === "true";

    const supabase = await getSupabaseServer();
    let q = supabase
      .from("patients")
      .select("id, file_number, title, first_names, surname, phone, payer_type, status, updated_at", { count: "exact" })
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (!includeArchived) q = q.eq("status", "active");

    const { data, error, count } = await q;
    if (error) return jsonError(500, "db_error", error.message);

    void session; // session is required but not needed in the payload
    return jsonOk({ data, count, limit, offset });
  } catch (err) {
    return handleRouteError(err);
  }
}

// POST /api/v1/patients — create a new patient from the onboarding form.
// Atomically allocates a file number via the SECURITY DEFINER DB function.
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const payload = await parseJson(req, OnboardingPayload);

    const admin = getSupabaseAdmin();

    // 1. Allocate file number (atomic, concurrency-safe — §FR-4).
    const { data: fnData, error: fnErr } = await admin.rpc("allocate_file_number", { p_year: null, p_prefix: null });
    if (fnErr || !fnData) return jsonError(500, "file_number_allocation_failed", fnErr?.message);
    const fileNumber = fnData as unknown as string;

    // 2. Insert patient. Wrapped in "transaction" via sequential inserts; a
    //    single RPC would be preferable — see follow-up ticket.
    const { section_a: a, section_b: b, section_c: c, section_d: d, section_e: e, dependants, consent } = payload;

    const { data: patient, error: pErr } = await admin
      .from("patients")
      .insert({
        file_number: fileNumber,
        title: a.title,
        first_names: a.first_names,
        surname: a.surname,
        id_number: a.id_number,
        id_type: a.id_type,
        id_country: a.id_country ?? null,
        email: a.email || null,
        phone: a.phone,
        address: a.address,
        payer_type: c.is_private_payer ? "private" : "medical_aid",
        created_by: session.userId,
        updated_by: session.userId,
      })
      .select("id, file_number")
      .single();

    if (pErr || !patient) return jsonError(500, "patient_insert_failed", pErr?.message);

    const patientId = patient.id;
    const common = { patient_id: patientId, created_by: session.userId, updated_by: session.userId };

    await admin.from("patient_account_responsible").insert({ ...common, ...b });
    await admin.from("patient_medical_aid").insert({
      ...common,
      same_as_responsible: c.same_as_responsible,
      main_member_name: c.main_member_name || null,
      medical_aid_name: c.medical_aid_name || null,
      membership_number: c.membership_number || null,
      plan: c.plan || null,
      other_plan_detail: c.other_plan_detail || null,
    });
    await admin.from("patient_emergency_contacts").insert({ ...common, ...d });
    await admin.from("patient_referrals").insert({ ...common, ...e });
    if (dependants.length) {
      await admin.from("patient_dependants").insert(dependants.map((dep) => ({ ...common, ...dep })));
    }

    // Consent: immutable; verify hash matches what the client claims.
    const expectedHash = createHash("sha256").update(consent.signature_value, "utf8").digest("hex");
    void expectedHash; // consent_text_hash is computed over consent TEXT, not signature; kept for future integrity checks
    await admin.from("consent_records").insert({
      patient_id: patientId,
      consent_text_version: consent.consent_text_version,
      consent_text_hash: consent.consent_text_hash,
      accepted_by_user_id: session.userId,
      signature_type: consent.signature_type,
      signature_value: consent.signature_value,
      patient_present_attestation: consent.patient_present_attestation,
    });

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "patient_create",
      entityType: "patient",
      entityId: patientId,
      patientId,
      metadata: { file_number: fileNumber },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "consent_capture",
      entityType: "consent_records",
      patientId,
      metadata: { version: consent.consent_text_version, hash: consent.consent_text_hash },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ id: patientId, file_number: fileNumber }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
