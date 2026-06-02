import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { clientIp, handleRouteError, jsonError, jsonOk } from "@/lib/api/http";
import { getHandwrittenNotesFeatures } from "@/lib/clinical-notes/features";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  try {
    const session = await requireRole("doctor");
    const { id, noteId } = await params;
    const supabase = await getSupabaseServer();
    if (!getHandwrittenNotesFeatures().finaliseEnabled) {
      const { data: note, error: noteError } = await supabase
        .from("clinical_notes")
        .select("encrypted_ink")
        .eq("id", noteId)
        .eq("patient_id", id)
        .maybeSingle();
      if (noteError) return jsonError(500, "db_error", noteError.message);
      if (!note) return jsonError(404, "not_found");
      if (note.encrypted_ink) return jsonError(409, "handwritten_finalise_disabled", "Handwritten notes remain drafts during this rollout stage.");
    }

    const { error } = await supabase
      .from("clinical_notes")
      .update({ is_finalised: true, finalised_at: new Date().toISOString() })
      .eq("id", noteId)
      .eq("patient_id", id)
      .eq("is_finalised", false);
    if (error) return jsonError(500, "db_error", error.message);

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "note_finalise",
      entityType: "clinical_notes",
      entityId: noteId,
      patientId: id,
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
