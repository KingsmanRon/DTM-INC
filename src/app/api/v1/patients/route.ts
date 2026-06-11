import type { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { OnboardingPayload, type OnboardingPayload as OnboardingPayloadType } from "@/lib/validation/patient";
import { isActiveHospital } from "@/lib/hospitals";
import { clientIp, handleRouteError, jsonError, jsonOk, parseJson } from "@/lib/api/http";


type PatientIdentity = {
  idType: "sa_id" | "passport";
  idNumber: string;
  idCountry: string | null;
};

function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : undefined;
}

function normalizeOnboardingPayload(payload: OnboardingPayloadType): OnboardingPayloadType {
  return {
    ...payload,
    section_a: {
      ...payload.section_a,
      is_minor: payload.section_a.is_minor ?? false,
      id_number: payload.section_a.id_number.trim().toUpperCase(),
      id_country: payload.section_a.id_type === "passport" ? normalizeOptional(payload.section_a.id_country) : undefined,
    },
    section_b: {
      ...payload.section_b,
      id_number: payload.section_b.id_number.trim().toUpperCase(),
    },
  };
}

function patientIdentity(payload: OnboardingPayloadType): PatientIdentity | null {
  const { id_type: idType, id_number: idNumber, id_country: idCountry } = payload.section_a;
  if (idType === "none_minor") return null;
  const normalizedIdNumber = idNumber.trim().toUpperCase();
  if (!normalizedIdNumber) return null;
  return {
    idType,
    idNumber: normalizedIdNumber,
    idCountry: idType === "passport" ? (normalizeOptional(idCountry) ?? null) : null,
  };
}

function isPatientIdentityConflict(error: { code?: string; message?: string; details?: string }): boolean {
  const text = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return error.code === "23505" && text.includes("patients_unique_identity_idx");
}

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
    // Default to the active_patients view (migration 0004). Archived access
    // is a separate, deliberate code path for SAR lookups and goes through
    // the full patients table with an explicit archived filter.
    //
    // No count:"exact" — fetch limit+1 and derive hasMore from the overflow
    // row instead of making Postgres count the whole table per page.
    const source = includeArchived ? "patients" : "active_patients";
    const q = supabase
      .from(source)
      .select("id, file_number, title, first_names, surname, phone, payer_type, status, updated_at")
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit); // one extra row on purpose

    const { data, error } = await q;
    if (error) return jsonError(500, "db_error", error.message);

    void session; // session is required but not needed in the payload
    const rows = data ?? [];
    const hasMore = rows.length > limit;
    return jsonOk({ data: hasMore ? rows.slice(0, limit) : rows, limit, offset, hasMore });
  } catch (err) {
    return handleRouteError(err);
  }
}

// POST /api/v1/patients — create a new patient from the onboarding form.
// The transactional fan-out (patient + 6 sub-resources) is done by the
// onboard_patient RPC. This handler's job is auth, consent verification, and
// audit writes.
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const parsedPayload = (await parseJson(req, OnboardingPayload)) as OnboardingPayloadType;
    const payload = normalizeOnboardingPayload(parsedPayload);
    const { consent } = payload;

    // Consent verification — re-derive the hash server-side from the
    // currently-active consent body in practice_settings. If the client's
    // claimed hash doesn't match, the user signed stale text (e.g. admin
    // updated the consent body while the wizard was open). Reject.
    const supabase = await getSupabaseServer();

    // Hospital is data, not an enum (0044): check the table here for a clean
    // 422; onboard_patient hard-fails on unknown/inactive as the backstop.
    if (!(await isActiveHospital(supabase, payload.section_a.hospital))) {
      return jsonError(422, "invalid_hospital", "Please select a valid hospital.");
    }
    const { data: settings, error: settingsErr } = await supabase
      .from("practice_settings")
      .select("active_consent_version, active_consent_body")
      .eq("id", 1)
      .single();
    if (settingsErr || !settings) {
      return jsonError(500, "consent_settings_unavailable", settingsErr?.message);
    }

    const identity = patientIdentity(payload);
    if (identity) {
      let duplicateQuery = supabase
        .from("patients")
        .select("id, file_number, archived_at")
        .eq("id_type", identity.idType)
        .eq("id_number", identity.idNumber)
        .limit(1);
      if (identity.idType === "passport") {
        duplicateQuery = identity.idCountry
          ? duplicateQuery.eq("id_country", identity.idCountry)
          : duplicateQuery.is("id_country", null);
      }

      const { data: duplicatePatients, error: duplicateErr } = await duplicateQuery;
      if (duplicateErr) return jsonError(500, "duplicate_check_failed", duplicateErr.message);
      const duplicate = duplicatePatients?.[0];
      if (duplicate) {
        return jsonError(
          409,
          "duplicate_patient",
          `A patient with this ID already exists as file ${duplicate.file_number}. Open the existing record instead of creating a duplicate.`,
          { existing: { id: duplicate.id, file_number: duplicate.file_number, archived_at: duplicate.archived_at } }
        );
      }
    }

    const serverHash = createHash("sha256")
      .update(`${settings.active_consent_version}::${settings.active_consent_body}`, "utf8")
      .digest("hex");
    if (
      consent.consent_text_version !== settings.active_consent_version ||
      consent.consent_text_hash !== serverHash
    ) {
      return jsonError(
        422,
        "consent_body_out_of_date",
        "The active consent text has changed since this form was loaded. Please reload and re-capture consent."
      );
    }

    const { data, error } = await supabase.rpc("onboard_patient", {
      p_actor_user_id: session.userId,
      p_section_a: payload.section_a,
      p_section_b: payload.section_b,
      p_section_c: payload.section_c,
      p_section_d: payload.section_d,
      p_section_e: payload.section_e,
      p_dependants: payload.dependants ?? [],
      p_consent: consent,
    });
    if (error) {
      if (isPatientIdentityConflict(error)) {
        return jsonError(
          409,
          "duplicate_patient",
          "A patient with this ID already exists. Search for and open the existing record instead of creating a duplicate."
        );
      }
      return jsonError(500, "onboarding_failed", error.message);
    }

    // RPC returns setof (patient_id, file_number); supabase-js surfaces it as
    // an array of one row.
    const row = Array.isArray(data) ? data[0] : data;
    const patientId = row?.patient_id as string | undefined;
    const fileNumber = row?.file_number as string | undefined;
    if (!patientId || !fileNumber) return jsonError(500, "onboarding_failed", "no row returned");

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
