import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase/server";
import { handleRouteError, jsonError, jsonOk, parseJson } from "@/lib/api/http";
import {
  ALLOWED_DOCUMENT_MIME_SET,
  DOCUMENT_CATEGORY_SET,
  MAX_DOCUMENT_BYTES,
  safeStorageName,
} from "@/lib/documents/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "patient-documents";

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

// Step 1 of the signed-URL upload flow. The browser sends only file *metadata*
// (a few hundred bytes) — never the bytes — so this request stays far under
// Vercel's ~4.5 MB serverless body cap that broke the old proxy-through-the-
// function design (it returned a platform 413 before our 25 MB check could run).
// We validate, mint a patient-scoped storage key the client cannot repoint at
// another patient, and hand back a single-use signed upload URL. The bytes then
// go browser -> Supabase directly; the row + audit are written by /finalize.
const InitSchema = z.object({
  filename: z.string().min(1).max(300),
  category: z.string(),
  mime: z.string(),
  size: z.number().int().positive(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(["doctor", "staff"]);
    const { id } = await params;
    const body = await parseJson(req, InitSchema);

    if (!ALLOWED_DOCUMENT_MIME_SET.has(body.mime)) return jsonError(415, "unsupported_media_type");
    if (!DOCUMENT_CATEGORY_SET.has(body.category)) return jsonError(400, "invalid_category");
    if (body.size > MAX_DOCUMENT_BYTES) return jsonError(413, "file_too_large");

    const storageKey = `${id}/${randomUUID()}/${safeStorageName(body.filename)}`;
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(storageKey);
    if (error || !data) return jsonError(500, "sign_failed", error?.message);

    return jsonOk({ token: data.token, path: data.path, storageKey, maxBytes: MAX_DOCUMENT_BYTES });
  } catch (err) {
    return handleRouteError(err);
  }
}
