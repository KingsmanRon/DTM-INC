import type { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { renderOnboardingPdf } from "@/lib/pdf/onboarding";
import { clientIp, handleRouteError, jsonError } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const { id } = await params;
    const supabase = await getSupabaseServer();

    const [practiceRes, patientRes, respRes, maRes, contactsRes, refRes, depRes, consentRes] = await Promise.all([
      supabase.from("practice_settings").select("*").eq("id", 1).single(),
      supabase.from("patients").select("*").eq("id", id).single(),
      supabase.from("patient_account_responsible").select("*").eq("patient_id", id).maybeSingle(),
      supabase.from("patient_medical_aid").select("*").eq("patient_id", id).maybeSingle(),
      supabase.from("patient_emergency_contacts").select("*").eq("patient_id", id),
      supabase.from("patient_referrals").select("*").eq("patient_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("patient_dependants").select("*").eq("patient_id", id).is("archived_at", null),
      supabase.from("consent_records").select("*").eq("patient_id", id).order("accepted_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

    if (patientRes.error || !patientRes.data) return jsonError(404, "not_found");
    const p = practiceRes.data!;

    const pdf = await renderOnboardingPdf({
      practice: {
        name: p.practice_name, tagline: p.practice_tagline, practiceNumber: p.practice_number,
        doctorName: p.doctor_name, qualifications: p.doctor_qualifications,
        address: p.practice_address, phone: p.practice_phone,
      },
      fileNumber: patientRes.data.file_number,
      patient: patientRes.data,
      responsible: respRes.data,
      medicalAid: maRes.data,
      contacts: contactsRes.data ?? [],
      referral: refRes.data,
      dependants: depRes.data ?? [],
      consent: consentRes.data ? {
        version: consentRes.data.consent_text_version,
        hash: consentRes.data.consent_text_hash,
        acceptedBy: consentRes.data.accepted_by_user_id,
        acceptedAt: consentRes.data.accepted_at,
        signatureType: consentRes.data.signature_type,
        signatureValue: consentRes.data.signature_value,
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
      metadata: { sha256, file_number: patientRes.data.file_number, bytes: pdf.length },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    const disposition = req.nextUrl.searchParams.get("disposition") === "inline" ? "inline" : "attachment";

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="onboarding-${patientRes.data.file_number}.pdf"`,
        "Cache-Control": "no-store",
        "X-Content-SHA256": sha256,
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
