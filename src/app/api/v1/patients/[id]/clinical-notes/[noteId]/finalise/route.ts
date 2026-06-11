import type { NextRequest } from "next/server";
import { Buffer } from "node:buffer";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer, getSupabaseAdmin } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { encryptNoteBytes, unwrapDek, zero, KeyManagementUnavailableError } from "@/lib/crypto/envelope";
import { byteaToCryptoBuffer, cryptoBufferToBase64 } from "@/lib/bytea";
import { clientIp, handleRouteError, jsonError, jsonOk } from "@/lib/api/http";
import { getHandwrittenNotesFeatures } from "@/lib/clinical-notes/features";
import { MAX_INK_PNG_BYTES } from "@/lib/clinical-notes/limits";

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
    const features = getHandwrittenNotesFeatures();

    const { data: note, error: noteError } = await supabase
      .from("clinical_notes")
      .select("id, dek_id, encrypted_ink, is_finalised")
      .eq("id", noteId)
      .eq("patient_id", id)
      .maybeSingle();
    if (noteError) return jsonError(500, "db_error", noteError.message);
    if (!note) return jsonError(404, "not_found");
    // Already finalised: report it instead of running the (0-row) update and
    // writing a note_finalise audit row for a transition that never happened.
    if (note.is_finalised) {
      return jsonError(409, "already_finalised", "This note is already finalised.");
    }

    const isInk = Boolean(note.encrypted_ink);
    if (isInk && !features.finaliseEnabled) {
      return jsonError(409, "handwritten_finalise_disabled", "Handwritten notes remain drafts during this rollout stage.");
    }

    const update: Record<string, unknown> = {
      is_finalised: true,
      finalised_at: new Date().toISOString(),
    };

    // A handwritten note may only be finalised together with the rasterised PNG
    // of its strokes (captured client-side). Migration 0027 makes finalised rows
    // immutable, so this is the only chance to attach the durable image — never
    // lock handwriting without it.
    if (isInk) {
      let inkPngB64: string | undefined;
      try {
        const parsed = await req.json();
        if (parsed && typeof parsed.ink_png === "string") inkPngB64 = parsed.ink_png;
      } catch {
        /* no/invalid body — handled by the required-image check below */
      }
      if (inkPngB64?.startsWith("data:")) inkPngB64 = inkPngB64.slice(inkPngB64.indexOf(",") + 1);
      if (!inkPngB64) {
        return jsonError(400, "ink_png_required", "A rasterised image is required to finalise a handwritten note.");
      }

      const pngBuf = Buffer.from(inkPngB64, "base64");
      if (pngBuf.length === 0) return jsonError(400, "ink_png_invalid", "The handwriting image could not be decoded.");
      if (pngBuf.length > MAX_INK_PNG_BYTES) return jsonError(413, "ink_png_too_large", "The handwriting image is too large.");

      const admin = getSupabaseAdmin();
      const { data: keyRow, error: keyErr } = await admin
        .from("patient_encryption_keys")
        .select("wrapped_dek")
        .eq("id", note.dek_id)
        .maybeSingle();
      if (keyErr || !keyRow) return jsonError(500, "dek_lookup_failed", keyErr?.message);

      let dek: Buffer | null = null;
      try {
        try {
          dek = await unwrapDek(byteaToCryptoBuffer(keyRow.wrapped_dek));
        } catch (e) {
          if (e instanceof KeyManagementUnavailableError) {
            return jsonError(503, "notes_unavailable", "Clinical notes encryption is not configured.");
          }
          throw e;
        }
        const enc = encryptNoteBytes(dek, pngBuf);
        update.encrypted_ink_png = cryptoBufferToBase64(enc.ciphertext);
        update.ink_png_nonce = cryptoBufferToBase64(enc.nonce);
      } finally {
        if (dek) zero(dek);
      }
    }

    // .eq("is_finalised", false) keeps a racing double-submit from tripping the
    // 0027 immutability guard; .select() verifies a row actually transitioned so
    // the audit row below is only written for a real finalisation.
    const { data: finalised, error } = await supabase
      .from("clinical_notes")
      .update(update)
      .eq("id", noteId)
      .eq("patient_id", id)
      .eq("is_finalised", false)
      .select("id")
      .maybeSingle();
    if (error) return jsonError(500, "db_error", error.message);
    if (!finalised) return jsonError(409, "already_finalised", "This note is already finalised.");

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "note_finalise",
      entityType: "clinical_notes",
      entityId: noteId,
      patientId: id,
      metadata: isInk ? { handwritten: true } : undefined,
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
