import { NextRequest } from "next/server";
import { z } from "zod";
import { Buffer } from "node:buffer";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseAdmin, getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import {
  encryptNoteBody, unwrapDek, zero, KeyManagementUnavailableError,
} from "@/lib/crypto/envelope";
import { byteaToCryptoBuffer, cryptoBufferToBase64 } from "@/lib/bytea";
import { clientIp, handleRouteError, jsonError, jsonOk, parseJson } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NoteAmend = z.object({
  note_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  body: z.string().max(50_000),
}).superRefine((input, ctx) => {
  if (!input.body.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "An amendment must contain text." });
  }
});

// POST /api/v1/patients/:id/clinical-notes/:noteId/amend
//
// Append-only edit for TYPED notes: creates a new note that supersedes :noteId.
// The source row is auto-finalised (so the chain has a single editable head)
// and the new row carries amended_from_note_id = :noteId. The new row starts
// as Unfinalised — the doctor reviews the amendment and finalises it like a
// fresh note.
//
// The amendment is dated TODAY by default; the original encounter date stays
// visible via the "Supersedes <date>" label in the UI.
//
// Handwritten notes are NOT amendable: amendments are typed text only. A
// request to amend a handwritten source is refused.
//
// Refuses if :noteId already has an amend pointing at it; the caller must amend
// the latest version in the chain instead.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  try {
    const session = await requireRole("doctor");
    const { id, noteId } = await params;
    const input = await parseJson(req, NoteAmend);

    // RLS client for everything that touches clinical_notes (review #9): the
    // doctor-only policy + author trigger stay in the path. ONLY the wrapped-
    // DEK fetch uses the admin client (patient_encryption_keys is readable to
    // doctors but managed via service role; mirrors the create path).
    const rls = await getSupabaseServer();
    const admin = getSupabaseAdmin();

    const { data: source, error: sourceErr } = await rls
      .from("clinical_notes")
      .select("id, patient_id, dek_id, is_finalised, encrypted_ink")
      .eq("id", noteId)
      .eq("patient_id", id)
      .maybeSingle();
    if (sourceErr) return jsonError(500, "db_error", sourceErr.message);
    if (!source) return jsonError(404, "not_found");

    // Handwritten notes cannot be amended — amendments are typed-only.
    if (source.encrypted_ink) {
      return jsonError(409, "handwritten_not_amendable", "Handwritten notes cannot be amended.");
    }

    const { data: alreadyAmended } = await rls
      .from("clinical_notes")
      .select("id")
      .eq("amended_from_note_id", noteId)
      .limit(1)
      .maybeSingle();
    if (alreadyAmended) {
      return jsonError(409, "already_amended", "This note has already been amended; amend the latest version instead.");
    }

    const { data: keyRow, error: keyErr } = await admin
      .from("patient_encryption_keys")
      .select("id, wrapped_dek")
      .eq("id", source.dek_id)
      .maybeSingle();
    if (keyErr || !keyRow) return jsonError(500, "dek_lookup_failed", keyErr?.message);

    let newId: string | null = null;
    let dek: Buffer | null = null;
    try {
      const wrapped = byteaToCryptoBuffer(keyRow.wrapped_dek);
      try {
        dek = await unwrapDek(wrapped);
      } catch (e) {
        if (e instanceof KeyManagementUnavailableError) {
          return jsonError(503, "notes_unavailable", "Clinical notes encryption is not configured.");
        }
        throw e;
      }

      const encBody = encryptNoteBody(dek, input.body);

      // Auto-finalise a still-draft source so the chain has a single head.
      if (!source.is_finalised) {
        const { error: finErr } = await rls
          .from("clinical_notes")
          .update({ is_finalised: true, finalised_at: new Date().toISOString() })
          .eq("id", noteId)
          .eq("is_finalised", false);
        if (finErr) return jsonError(500, "db_error", finErr.message);
      }

      const { data: inserted, error: insErr } = await rls
        .from("clinical_notes")
        .insert({
          patient_id: id,
          author_user_id: session.userId,
          note_date: input.note_date ?? new Date().toISOString().slice(0, 10),
          encrypted_body: cryptoBufferToBase64(encBody.ciphertext),
          nonce: cryptoBufferToBase64(encBody.nonce),
          dek_id: source.dek_id,
          amended_from_note_id: noteId,
        })
        .select("id")
        .single();
      if (insErr || !inserted) return jsonError(500, "db_error", insErr?.message);
      newId = inserted.id;
    } finally {
      if (dek) zero(dek);
    }

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "note_amend",
      entityType: "clinical_notes",
      entityId: newId,
      patientId: id,
      metadata: { amended_from_note_id: noteId },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ id: newId }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
