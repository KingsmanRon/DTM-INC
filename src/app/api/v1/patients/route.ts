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
    // Default to the active_patients view (migration 0004). Archived access
    // is a separate, deliberate code path for SAR lookups and goes through
    // the full patients table with an explicit archived filter.
    const source = includeArchived ? "patients" : "active_patients";
    const q = supabase
      .from(source)
      .select("id, file_number, title, first_names, surname, phone, payer_type, status, updated_at", { count: "exact" })
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await q;
    if (error) return jsonError(500, "db_error", error.message);

    void session; // session is required but not needed in the payload
    return jsonOk({ data, count, limit, offset });
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
    const payload = await parseJson(req, OnboardingPayload);
    const { consent } = payload;

    // Consent verification — re-derive the hash server-side from the
    // currently-active consent body in practice_settings. If the client's
    // claimed hash doesn't match, the user signed stale text (e.g. admin
    // updated the consent body while the wizard was open). Reject.
    const supabase = await getSupabaseServer();
    const { data: settings, error: settingsErr } = await supabase
      .from("practice_settings")
      .select("active_consent_version, active_consent_body")
      .eq("id", 1)
      .single();
    if (settingsErr || !settings) {
      return jsonError(500, "consent_settings_unavailable", settingsErr?.message);
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

    const admin = getSupabaseAdmin();
    const { data, error } = await admin.rpc("onboard_patient", {
      p_actor_user_id: session.userId,
      p_section_a: payload.section_a,
      p_section_b: payload.section_b,
      p_section_c: payload.section_c,
      p_section_d: payload.section_d,
      p_section_e: payload.section_e,
      p_dependants: payload.dependants ?? [],
      p_consent: consent,
    });
    if (error) return jsonError(500, "onboarding_failed", error.message);

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
