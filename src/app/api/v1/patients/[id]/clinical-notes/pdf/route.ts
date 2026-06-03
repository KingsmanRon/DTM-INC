import type { NextRequest } from "next/server";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer, getSupabaseAdmin } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { decryptNoteBody, decryptNoteBytes, unwrapDek, zero, KeyManagementUnavailableError } from "@/lib/crypto/envelope";
import { byteaToCryptoBuffer } from "@/lib/bytea";
import { clientIp, handleRouteError, jsonError } from "@/lib/api/http";
import { getHandwrittenNotesFeatures } from "@/lib/clinical-notes/features";
import { renderClinicalNotesPdf } from "@/lib/pdf/clinical-notes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/patients/:id/clinical-notes/pdf
// Doctor-only export of the patient's clinical notes. Gated behind
// FEATURE_HANDWRITTEN_NOTES_PDF; returns 404 (not 403) when disabled so the
// endpoint stays invisible, matching the rest of the clinical-notes surface.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole("doctor");
    const { id } = await params;
    if (!getHandwrittenNotesFeatures().pdfEnabled) return jsonError(404, "not_found");
    const supabase = await getSupabaseServer();

    const [{ data: practice }, { data: patient, error: patientErr }] = await Promise.all([
      supabase.from("practice_settings").select("*").eq("id", 1).maybeSingle(),
      supabase.from("patients").select("*").eq("id", id).maybeSingle(),
    ]);
    if (patientErr) return jsonError(500, "db_error", patientErr.message);
    if (!patient) return jsonError(404, "not_found");

    const { data: notes, error } = await supabase
      .from("clinical_notes")
      .select("id, note_date, encrypted_body, nonce, encrypted_ink, encrypted_ink_png, ink_png_nonce, is_finalised, created_at")
      .eq("patient_id", id)
      .order("created_at", { ascending: true });
    if (error) return jsonError(500, "db_error", error.message);

    const items: Array<{ note_date: string; is_finalised: boolean; body: string; inkPng: Buffer | null; hasInk: boolean }> = [];
    if (notes && notes.length > 0) {
      const admin = getSupabaseAdmin();
      const { data: keyRow } = await admin
        .from("patient_encryption_keys")
        .select("wrapped_dek")
        .eq("patient_id", id)
        .maybeSingle();

      let dek: Buffer | null = null;
      try {
        if (keyRow) {
          try {
            dek = await unwrapDek(byteaToCryptoBuffer(keyRow.wrapped_dek));
          } catch (e) {
            if (e instanceof KeyManagementUnavailableError) return jsonError(503, "notes_unavailable", "Clinical notes encryption is not configured.");
            throw e;
          }
        }
        for (const n of notes) {
          const body = dek && n.encrypted_body && n.nonce
            ? decryptNoteBody(dek, byteaToCryptoBuffer(n.encrypted_body), byteaToCryptoBuffer(n.nonce))
            : "";
          const inkPng = dek && n.encrypted_ink_png && n.ink_png_nonce
            ? decryptNoteBytes(dek, byteaToCryptoBuffer(n.encrypted_ink_png), byteaToCryptoBuffer(n.ink_png_nonce))
            : null;
          items.push({ note_date: n.note_date, is_finalised: n.is_finalised, body, inkPng, hasInk: Boolean(n.encrypted_ink) });
        }
      } finally {
        if (dek) zero(dek);
      }
    }

    const pdf = await renderClinicalNotesPdf({
      practice: {
        name: practice?.practice_name ?? "",
        doctorName: practice?.doctor_name ?? "",
        qualifications: practice?.doctor_qualifications ?? "",
        practiceNumber: practice?.practice_number ?? "",
        address: practice?.practice_address ?? "",
        phone: practice?.practice_phone ?? "",
      },
      fileNumber: patient.file_number,
      patientName: [patient.title, patient.first_names, patient.surname].filter(Boolean).join(" "),
      notes: items,
    });

    const sha256 = createHash("sha256").update(pdf).digest("hex");

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "note_read",
      entityType: "clinical_notes",
      patientId: id,
      metadata: { kind: "pdf_export", count: items.length, sha256, bytes: pdf.length },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    const disposition = req.nextUrl.searchParams.get("disposition") === "inline" ? "inline" : "attachment";
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="clinical-notes-${patient.file_number}.pdf"`,
        "Cache-Control": "no-store",
        "X-Content-SHA256": sha256,
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
