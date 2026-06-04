import type { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { renderOnboardingPdf } from "@/lib/pdf/onboarding";
import { getPatientBundle } from "@/lib/patients/bundle";
import { clientIp, handleRouteError, jsonError } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const { id } = await params;
    const supabase = await getSupabaseServer();

    const [practiceRes, bundleRes] = await Promise.all([
      supabase.from("practice_settings").select("*").eq("id", 1).single(),
      getPatientBundle(supabase, id, { includeConsent: true }),
    ]);

    if (bundleRes.error) return jsonError(500, "db_error", bundleRes.error.message);
    if (!bundleRes.data) return jsonError(404, "not_found");
    if (practiceRes.error || !practiceRes.data) return jsonError(500, "db_error", practiceRes.error?.message);
    const p = practiceRes.data;
    const bundle = bundleRes.data;

    const pdf = await renderOnboardingPdf({
      practice: {
        name: p.practice_name, tagline: p.practice_tagline, practiceNumber: p.practice_number,
        doctorName: p.doctor_name, qualifications: p.doctor_qualifications,
        address: p.practice_address, phone: p.practice_phone,
      },
      fileNumber: bundle.patient.file_number ?? "",
      patient: bundle.patient,
      responsible: bundle.responsible,
      medicalAid: bundle.medical_aid,
      contacts: bundle.contacts,
      referral: bundle.referral,
      dependants: bundle.dependants,
      consent: bundle.consent ? {
        version: bundle.consent.consent_text_version ?? "",
        hash: bundle.consent.consent_text_hash ?? "",
        acceptedBy: bundle.consent.accepted_by_user_id ?? "",
        acceptedAt: bundle.consent.accepted_at ?? "",
        signatureType: bundle.consent.signature_type ?? "",
        signatureValue: bundle.consent.signature_value ?? "",
      } : null,
    });

    const sha256 = createHash("sha256").update(pdf).digest("hex");

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "onboarding_pdf_generate",
      entityType: "patient",
      entityId: id,
      patientId: id,
      metadata: { sha256, file_number: bundle.patient.file_number ?? null, bytes: pdf.length },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    const disposition = req.nextUrl.searchParams.get("disposition") === "inline" ? "inline" : "attachment";

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="onboarding-${bundle.patient.file_number ?? id}.pdf"`,
        "Cache-Control": "no-store",
        "X-Content-SHA256": sha256,
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
