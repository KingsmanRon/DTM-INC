import type { NextRequest } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { clientIp, handleRouteError, jsonError, jsonOk } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/heic", "image/webp"]);
const MAX_BYTES = 25 * 1024 * 1024;
const CATEGORIES = new Set([
  "id_copy", "medical_aid_card", "consent_form", "referral_letter",
  "pathology_result", "imaging_report", "correspondence", "other",
]);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(["doctor", "staff"]);
    const { id } = await params;
    const supabase = await getSupabaseServer();
    const { data, error } = await supabase
      .from("patient_documents")
      .select("id, category, original_filename, mime_type, file_size, uploaded_at, uploaded_by, archived_at")
      .eq("patient_id", id)
      .is("archived_at", null)
      .order("uploaded_at", { ascending: false });
    if (error) return jsonError(500, "db_error", error.message);
    return jsonOk({ documents: data });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const { id } = await params;
    const form = await req.formData();
    const file = form.get("file");
    const category = String(form.get("category") ?? "");

    if (!(file instanceof File)) return jsonError(400, "missing_file");
    if (!CATEGORIES.has(category)) return jsonError(400, "invalid_category");
    if (!ALLOWED.has(file.type)) return jsonError(415, "unsupported_media_type");
    if (file.size > MAX_BYTES) return jsonError(413, "file_too_large");

    const bytes = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storageKey = `${id}/${randomUUID()}/${Date.now()}`;

    const admin = getSupabaseAdmin();
    const { error: upErr } = await admin.storage
      .from("patient-documents")
      .upload(storageKey, bytes, { contentType: file.type, upsert: false });
    if (upErr) return jsonError(500, "storage_upload_failed", upErr.message);

    const { data, error: dbErr } = await admin
      .from("patient_documents")
      .insert({
        patient_id: id,
        category,
        storage_key: storageKey,
        original_filename: file.name,
        mime_type: file.type,
        file_size: file.size,
        sha256_hash: sha256,
        uploaded_by: session.userId,
      })
      .select("id")
      .single();
    if (dbErr) return jsonError(500, "db_error", dbErr.message);

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "document_upload",
      entityType: "patient_documents",
      entityId: data?.id ?? null,
      patientId: id,
      metadata: { category, sha256, size: file.size, mime: file.type },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ id: data?.id }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
