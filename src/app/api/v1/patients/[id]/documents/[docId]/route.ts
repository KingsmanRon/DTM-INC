import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { clientIp, handleRouteError, jsonError, jsonOk, parseJson } from "@/lib/api/http";
import { cleanDocumentName, withPreservedExtension } from "@/lib/documents/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Returns a short-lived signed URL (§FR-9). The client never gets the raw
// storage path — only the signed URL, valid for 5 minutes.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const { id, docId } = await params;
    const supabase = await getSupabaseServer();

    const { data: doc, error } = await supabase
      .from("patient_documents")
      .select("storage_key, original_filename, mime_type")
      .eq("id", docId)
      .eq("patient_id", id)
      .is("archived_at", null)
      .maybeSingle();
    if (error || !doc) return jsonError(404, "not_found");

    const admin = getSupabaseAdmin();
    const { data: signed, error: sErr } = await admin.storage
      .from("patient-documents")
      .createSignedUrl(doc.storage_key, 300);
    if (sErr || !signed) return jsonError(500, "sign_failed", sErr?.message);

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "document_view",
      entityType: "patient_documents",
      entityId: docId,
      patientId: id,
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ url: signed.signedUrl, filename: doc.original_filename, mime_type: doc.mime_type });
  } catch (err) {
    return handleRouteError(err);
  }
}

// Rename a document's display name (original_filename). This edits the label
// ONLY — the storage object keeps its stable, non-guessable key, so existing
// signed links and the file bytes are untouched. The update runs under the
// caller's RLS context (doctor/staff have an UPDATE policy on
// patient_documents); requireRole is the app-layer backstop. The original file
// extension is carried over so the renamed file stays openable.
const RenameSchema = z.object({ filename: z.string().min(1).max(255) });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const { id, docId } = await params;
    const { filename } = await parseJson(req, RenameSchema);

    const cleaned = cleanDocumentName(filename);
    if (!cleaned) return jsonError(400, "invalid_filename", "Please enter a file name.");

    const supabase = await getSupabaseServer();
    const { data: existing, error: readErr } = await supabase
      .from("patient_documents")
      .select("original_filename")
      .eq("id", docId)
      .eq("patient_id", id)
      .is("archived_at", null)
      .maybeSingle();
    if (readErr || !existing) return jsonError(404, "not_found");

    const newName = withPreservedExtension(cleaned, existing.original_filename);

    // No change → don't write a spurious row update or audit entry.
    if (newName === existing.original_filename) {
      return jsonOk({ document: { id: docId, original_filename: newName } });
    }

    const { data: updated, error: upErr } = await supabase
      .from("patient_documents")
      .update({ original_filename: newName })
      .eq("id", docId)
      .eq("patient_id", id)
      .is("archived_at", null)
      .select("id, category, original_filename, mime_type, file_size, uploaded_at, uploaded_by, archived_at")
      .single();
    if (upErr || !updated) return jsonError(500, "rename_failed", upErr?.message);

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "document_rename",
      entityType: "patient_documents",
      entityId: docId,
      patientId: id,
      metadata: { from: existing.original_filename, to: newName },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ document: updated });
  } catch (err) {
    return handleRouteError(err);
  }
}
