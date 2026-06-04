import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { clientIp, handleRouteError, jsonError, jsonOk, parseJson } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VoidClinicalNoteResult = {
  note_id: string;
  patient_id: string;
  voided_at: string;
  voided_by: string;
  void_reason: string;
};

const VoidClinicalNote = z.object({
  reason: z.string().transform((value) => value.trim()).pipe(z.string().min(3).max(2_000)),
});

function isMissingSchemaError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "42703" || code === "42883";
}

function rpcStatus(error: { code?: string } | null): number {
  if (error?.code === "PT404") return 404;
  if (error?.code === "PT409") return 409;
  if (error?.code === "42501") return 404;
  if (error?.code === "22023") return 400;
  return 500;
}

// POST /api/v1/patients/:id/clinical-notes/:noteId/void
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  try {
    const session = await requireRole("doctor");
    const { id, noteId } = await params;
    const input = await parseJson(req, VoidClinicalNote);
    const supabase = await getSupabaseServer();

    const { data: note, error: noteError } = await supabase
      .from("clinical_notes")
      .select("id")
      .eq("id", noteId)
      .eq("patient_id", id)
      .maybeSingle();
    if (noteError) {
      if (isMissingSchemaError(noteError)) {
        return jsonError(503, "notes_schema_unavailable", "Clinical notes voiding is not deployed.");
      }
      return jsonError(500, "db_error", noteError.message);
    }
    if (!note) return jsonError(404, "not_found");

    const { data, error } = await supabase.rpc("void_clinical_note", {
      p_note_id: noteId,
      p_reason: input.reason,
    }).single();

    if (error || !data) {
      if (isMissingSchemaError(error)) {
        return jsonError(503, "notes_schema_unavailable", "Clinical notes voiding is not deployed.");
      }
      return jsonError(rpcStatus(error), error?.code === "PT409" ? "invalid_void_transition" : "void_failed", error?.message);
    }

    const voidedNote = data as VoidClinicalNoteResult;

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "clinical_note_voided",
      entityType: "clinical_notes",
      entityId: noteId,
      patientId: id,
      metadata: {
        note_id: noteId,
        patient_id: id,
        voided_by: voidedNote.voided_by,
        voided_at: voidedNote.voided_at,
        reason: voidedNote.void_reason,
        previous_status: "finalised",
        new_status: "voided",
      },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ success: true, note_id: noteId, status: "voided" });
  } catch (err) {
    return handleRouteError(err);
  }
}
