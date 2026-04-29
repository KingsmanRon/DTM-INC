import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer, getSupabaseAdmin } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import {
  encryptNoteBody, decryptNoteBody, generateDek, wrapDek, unwrapDek, zero, KeyManagementUnavailableError,
} from "@/lib/crypto/envelope";
import { byteaToCryptoBuffer, cryptoBufferToBase64 } from "@/lib/bytea";
import { clientIp, handleRouteError, jsonError, jsonOk, parseJson } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Return 404 — not 403 — for non-doctor roles. Staff and admin must not even
// learn that this endpoint exists (§15 decision #2).
// All five handlers below share this policy via requireRole("doctor").

const NoteCreate = z.object({
  note_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  body: z.string().min(1).max(50_000),
});

class PatientNotFoundError extends Error {
  constructor() { super("patient_not_found"); }
}

function isMissingSchemaError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "42703";
}

async function getOrCreatePatientDek(patientId: string): Promise<{ dekId: string; dek: Buffer }> {
  const admin = getSupabaseAdmin();
  const { data: existing, error: existingErr } = await admin
    .from("patient_encryption_keys")
    .select("id, wrapped_dek")
    .eq("patient_id", patientId)
    .maybeSingle();
  if (existingErr) {
    if (isMissingSchemaError(existingErr)) {
      throw new Error("notes_schema_unavailable");
    }
    throw new Error("dek_lookup_failed: " + existingErr.message);
  }

  if (existing) {
    const wrapped = byteaToCryptoBuffer(existing.wrapped_dek);
    const dek = await unwrapDek(wrapped);
    return { dekId: existing.id, dek };
  }

  // No DEK row yet — verify the patient exists (and the caller can see them
  // under RLS) before allocating. Without this check, an arbitrary
  // route-param UUID would reach the INSERT and rely solely on the FK to
  // reject; a malformed UUID would short-circuit earlier, but a valid-format
  // UUID for a deleted/never-existed patient would leak error detail and
  // waste a KMS wrap round-trip.
  const rls = await getSupabaseServer();
  const { data: patient, error: patientErr } = await rls
    .from("patients")
    .select("id")
    .eq("id", patientId)
    .maybeSingle();
  if (patientErr) throw new Error("patient_lookup_failed: " + patientErr.message);
  if (!patient) throw new PatientNotFoundError();

  const dek = generateDek();
  const wrapped = await wrapDek(dek);
  const { data: inserted, error } = await admin
    .from("patient_encryption_keys")
    .insert({
      patient_id: patientId,
      wrapped_dek: cryptoBufferToBase64(wrapped),
      kek_id: process.env.CLINICAL_NOTES_KEK_ID ?? "vault:clinical-notes-kek/v1",
    })
    .select("id")
    .single();
  if (error || !inserted) throw new Error("dek_create_failed: " + error?.message);
  return { dekId: inserted.id, dek };
}

// GET /api/v1/patients/:id/clinical-notes
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole("doctor");
    const { id } = await params;
    const supabase = await getSupabaseServer();

    const { data: notes, error } = await supabase
      .from("clinical_notes")
      .select("id, patient_id, author_user_id, note_date, encrypted_body, nonce, dek_id, is_finalised, finalised_at, amended_from_note_id, created_at, updated_at")
      .eq("patient_id", id)
      .order("created_at", { ascending: false });
    if (error) {
      if (isMissingSchemaError(error)) return jsonError(503, "notes_schema_unavailable", "Clinical notes schema is not deployed.");
      return jsonError(500, "db_error", error.message);
    }

    // Decrypt each note. All notes under a patient share the same DEK.
    const results: Array<{ id: string; note_date: string; body: string; is_finalised: boolean; amended_from_note_id: string | null; created_at: string; updated_at: string }> = [];
    if (notes && notes.length > 0) {
      let dekHandle: { dek: Buffer } | null = null;
      try {
        dekHandle = await getOrCreatePatientDek(id);
      } catch (e) {
        if (e instanceof PatientNotFoundError) return jsonError(404, "not_found");
        if (e instanceof KeyManagementUnavailableError) return jsonError(503, "notes_unavailable", "Clinical notes encryption is not configured.");
        if ((e as Error).message === "notes_schema_unavailable") return jsonError(503, "notes_schema_unavailable", "Clinical notes schema is not deployed.");
        throw e;
      }
      const { dek } = dekHandle;
      try {
        for (const n of notes) {
          const ct = byteaToCryptoBuffer(n.encrypted_body);
          const nonce = byteaToCryptoBuffer(n.nonce);
          results.push({
            id: n.id,
            note_date: n.note_date,
            body: decryptNoteBody(dek, ct, nonce),
            is_finalised: n.is_finalised,
            amended_from_note_id: n.amended_from_note_id,
            created_at: n.created_at,
            updated_at: n.updated_at,
          });
        }
      } finally {
        zero(dek);
      }
    }

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "note_read",
      entityType: "clinical_notes",
      patientId: id,
      metadata: { count: results.length },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ notes: results });
  } catch (err) {
    return handleRouteError(err);
  }
}

// POST /api/v1/patients/:id/clinical-notes
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole("doctor");
    const { id } = await params;
    const input = await parseJson(req, NoteCreate);

    let dekHandle: { dekId: string; dek: Buffer };
    try {
      dekHandle = await getOrCreatePatientDek(id);
    } catch (e) {
      if (e instanceof PatientNotFoundError) return jsonError(404, "not_found");
      if (e instanceof KeyManagementUnavailableError) return jsonError(503, "notes_unavailable", "Clinical notes encryption is not configured.");
      if ((e as Error).message === "notes_schema_unavailable") return jsonError(503, "notes_schema_unavailable", "Clinical notes schema is not deployed.");
      throw e;
    }
    const { dekId, dek } = dekHandle;
    let noteId: string | null = null;
    try {
      const { ciphertext, nonce } = encryptNoteBody(dek, input.body);

      const admin = getSupabaseAdmin();
      const { data, error } = await admin
        .from("clinical_notes")
        .insert({
          patient_id: id,
          author_user_id: session.userId,
          note_date: input.note_date ?? new Date().toISOString().slice(0, 10),
          encrypted_body: cryptoBufferToBase64(ciphertext),
          nonce: cryptoBufferToBase64(nonce),
          dek_id: dekId,
        })
        .select("id")
        .single();
      if (error || !data) {
        if (isMissingSchemaError(error)) return jsonError(503, "notes_schema_unavailable", "Clinical notes schema is not deployed.");
        return jsonError(500, "db_error", error?.message);
      }
      noteId = data.id;
    } finally {
      zero(dek);
    }

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "note_create",
      entityType: "clinical_notes",
      entityId: noteId,
      patientId: id,
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ id: noteId }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
