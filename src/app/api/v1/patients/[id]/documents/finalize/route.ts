import type { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { clientIp, handleRouteError, jsonError, jsonOk, parseJson } from "@/lib/api/http";
import { checkDocumentContent } from "@/lib/documents/validate";
import { MAX_DOCUMENT_BYTES, normaliseDocumentMime } from "@/lib/documents/constants";
import { DOCUMENT_FIELDS } from "@/lib/documents/fields";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FinalizeSchema = z.object({
  storageKey: z.string().min(1).max(1024),
  filename: z.string().min(1).max(300),
  category: z.string(),
  mime: z.string(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const { id } = await params;
    const body = await parseJson(req, FinalizeSchema);
    const admin = getSupabaseAdmin();
    const { data: intent, error: intentError } = await admin
      .from("document_upload_intents")
      .select("id, original_filename, category, mime_type, declared_size, expires_at, document_id")
      .eq("storage_key", body.storageKey)
      .eq("patient_id", id)
      .eq("actor_user_id", session.userId)
      .maybeSingle();
    if (intentError) return jsonError(500, "upload_intent_unavailable");
    if (!intent) return jsonError(404, "upload_intent_not_found");
    if (body.filename !== intent.original_filename || body.category !== intent.category ||
        normaliseDocumentMime(body.mime) !== intent.mime_type) {
      return jsonError(409, "upload_intent_mismatch");
    }

    // Replay after a lost response must not download, delete, duplicate or
    // resurrect the original object, which may since have been compressed.
    if (intent.document_id) {
      const { data, error } = await admin.from("patient_documents").select(DOCUMENT_FIELDS)
        .eq("id", intent.document_id).eq("patient_id", id).is("archived_at", null).maybeSingle();
      if (error) return jsonError(500, "document_unavailable");
      if (!data) return jsonError(409, "upload_already_finalised");
      return jsonOk({ document: data }, { status: 201 });
    }
    if (new Date(intent.expires_at).getTime() <= Date.now()) return jsonError(410, "upload_intent_expired");

    const { data: blob, error: dlErr } = await admin.storage.from("patient-documents").download(body.storageKey);
    if (dlErr || !blob) return jsonError(404, "uploaded_object_not_found");
    const bytes = Buffer.from(await blob.arrayBuffer());
    if (!bytes.byteLength) return jsonError(400, "empty_file");
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) return jsonError(413, "file_too_large");
    if (bytes.byteLength !== Number(intent.declared_size)) return jsonError(400, "upload_size_mismatch");
    const content = await checkDocumentContent(bytes, intent.mime_type);
    if (!content.ok) return jsonError(415, "invalid_file_content");

    // Row lock, document insert, intent consumption and durable audit share one
    // DB transaction. Only the server can attest to the checked bytes and hash.
    const { data, error } = await admin.rpc("finalize_document_upload", {
      p_intent_id: intent.id,
      p_actor_user_id: session.userId,
      p_patient_id: id,
      p_file_size: bytes.byteLength,
      p_sha256: createHash("sha256").update(bytes).digest("hex"),
      p_mime: content.mime,
      p_ip_address: clientIp(req),
      p_user_agent: req.headers.get("user-agent"),
    }).select(DOCUMENT_FIELDS).maybeSingle();
    if (error || !data) {
      const status = error?.code === "PT410" ? 410 : error?.code === "PT409" ? 409 : 500;
      return jsonError(status, "could_not_record_document");
    }
    return jsonOk({ document: data }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}

// NO Storage deletion here, including errors/timeouts: an uncertain commit is
// not proof of an orphan. Abandoned uploads remain unregistered. Any later
// cleanup requires a separately reviewed lifecycle that protects references.
