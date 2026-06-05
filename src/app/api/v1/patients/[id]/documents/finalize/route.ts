import type { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { clientIp, handleRouteError, jsonError, jsonOk, parseJson } from "@/lib/api/http";
import { checkDocumentContent } from "@/lib/documents/validate";
import { DOCUMENT_CATEGORY_SET, MAX_DOCUMENT_BYTES } from "@/lib/documents/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "patient-documents";

const FinalizeSchema = z.object({
  storageKey: z.string().min(1).max(1024),
  filename: z.string().min(1).max(300),
  category: z.string(),
  mime: z.string(),
});

async function removeOrphan(admin: ReturnType<typeof getSupabaseAdmin>, key: string) {
  const { error } = await admin.storage.from(BUCKET).remove([key]);
  if (error) console.error("[documents.finalize] orphan cleanup failed", { key, error: error.message });
}

// Step 3 of the signed-URL upload flow. The bytes are already in Storage; here
// we (server-side) download them — this is function -> Supabase, NOT subject to
// the inbound 4.5 MB cap — re-check the real size, sniff the magic bytes to
// reject anything that isn't genuinely one of our allowed types, hash for
// integrity, then record the row and audit entry. Any rejection deletes the
// just-uploaded object so a failed finalize never leaves an orphan behind.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const { id } = await params;
    const body = await parseJson(req, FinalizeSchema);

    if (!DOCUMENT_CATEGORY_SET.has(body.category)) return jsonError(400, "invalid_category");
    // Ownership guard: the key must live under THIS patient's prefix, so a
    // signed URL minted for one patient can't be finalised onto another's record.
    if (!body.storageKey.startsWith(`${id}/`)) return jsonError(400, "invalid_storage_key");

    const admin = getSupabaseAdmin();

    const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(body.storageKey);
    if (dlErr || !blob) return jsonError(404, "uploaded_object_not_found");
    const bytes = Buffer.from(await blob.arrayBuffer());

    // The size sent at step 1 was client-supplied; trust only the bytes on disk.
    if (bytes.byteLength === 0) {
      await removeOrphan(admin, body.storageKey);
      return jsonError(400, "empty_file");
    }
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
      await removeOrphan(admin, body.storageKey);
      return jsonError(413, "file_too_large");
    }

    const content = await checkDocumentContent(bytes, body.mime);
    if (!content.ok) {
      await removeOrphan(admin, body.storageKey);
      return jsonError(415, "invalid_file_content");
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");

    const { data, error: dbErr } = await admin
      .from("patient_documents")
      .insert({
        patient_id: id,
        category: body.category,
        storage_key: body.storageKey,
        original_filename: body.filename,
        mime_type: content.mime,
        file_size: bytes.byteLength,
        sha256_hash: sha256,
        uploaded_by: session.userId,
      })
      .select("id, category, original_filename, mime_type, file_size, uploaded_at, uploaded_by, archived_at")
      .single();
    if (dbErr || !data) {
      await removeOrphan(admin, body.storageKey);
      return jsonError(500, "could_not_record_document", dbErr?.message);
    }

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "document_upload",
      entityType: "patient_documents",
      entityId: data.id,
      patientId: id,
      metadata: {
        category: body.category,
        sha256,
        size: bytes.byteLength,
        mime: content.mime,
        storage_key: body.storageKey,
      },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ document: data }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
