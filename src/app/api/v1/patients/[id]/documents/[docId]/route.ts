import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { clientIp, handleRouteError, jsonError, jsonOk, parseJson } from "@/lib/api/http";
import { forceExtension } from "@/lib/documents/constants";

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

    const supabase = await getSupabaseServer();
    const { data: existing, error: readErr } = await supabase
      .from("patient_documents")
      .select("original_filename")
      .eq("id", docId)
      .eq("patient_id", id)
      .is("archived_at", null)
      .maybeSingle();
    if (readErr || !existing) return jsonError(404, "not_found");

    // The extension is fixed to the real file type — strip anything the user
    // typed and re-apply the current file's extension (see forceExtension).
    const newName = forceExtension(filename, existing.original_filename);
    if (!newName) return jsonError(400, "invalid_filename", "Please enter a file name.");

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

// Remove a document from the patient's file — SOFT archive, never a hard
// delete. Exists because mis-uploads happen at the front desk (wrong file on
// the wrong patient) and POPIA's correction duty (s.24) needs a same-day fix:
// the document disappears from the Documents tab (the list filters
// archived_at IS NULL) while the bytes stay in Storage and the row stays in
// the DB for the audit trail. Doctor + staff — the same roles that can upload
// can correct an upload. Runs under the caller's RLS context.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const { id, docId } = await params;

    // Optional { reason } body — recorded in the audit row when supplied.
    let reason: string | null = null;
    try {
      const body = (await req.json()) as { reason?: string } | null;
      if (body && typeof body.reason === "string") {
        reason = body.reason.trim().slice(0, 500) || null;
      }
    } catch {
      /* no body — archiving without a stated reason is allowed */
    }

    const supabase = await getSupabaseServer();
    const { data: existing, error: readErr } = await supabase
      .from("patient_documents")
      .select("id, original_filename, category, archived_at")
      .eq("id", docId)
      .eq("patient_id", id)
      .maybeSingle();
    if (readErr) return jsonError(500, "db_error", readErr.message);
    if (!existing) return jsonError(404, "not_found");
    if (existing.archived_at) {
      return jsonError(409, "already_removed", "This document has already been removed.");
    }

    const { data: archived, error: archiveErr } = await supabase
      .from("patient_documents")
      .update({ archived_at: new Date().toISOString(), archived_by: session.userId })
      .eq("id", docId)
      .eq("patient_id", id)
      .is("archived_at", null)
      .select("id")
      .maybeSingle();
    if (archiveErr) return jsonError(500, "db_error", archiveErr.message);
    // Raced by a concurrent removal — nothing transitioned, so do not audit.
    if (!archived) return jsonError(409, "already_removed", "This document has already been removed.");

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "document_archive",
      entityType: "patient_documents",
      entityId: docId,
      patientId: id,
      metadata: {
        filename: existing.original_filename,
        category: existing.category,
        ...(reason ? { reason } : {}),
      },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ removed: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
