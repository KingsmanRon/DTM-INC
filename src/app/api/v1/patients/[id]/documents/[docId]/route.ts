import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { clientIp, handleRouteError, jsonError, jsonOk } from "@/lib/api/http";

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
