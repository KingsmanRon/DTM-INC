// Shared upload constraints for patient documents (§FR-9).
//
// This module is import-safe from BOTH server route handlers and client
// components — it must never pull in `file-type`, the Supabase admin client, or
// anything else that is server-only. The client uses MAX_DOCUMENT_BYTES for the
// pre-flight size check; the API routes use the same constants so the limit is
// defined in exactly one place.

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024; // 25 MB

export const ALLOWED_DOCUMENT_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
] as const;

export const ALLOWED_DOCUMENT_MIME_SET: ReadonlySet<string> = new Set(ALLOWED_DOCUMENT_MIME);

export const DOCUMENT_CATEGORIES = [
  "id_copy",
  "medical_aid_card",
  "consent_form",
  "referral_letter",
  "pathology_result",
  "imaging_report",
  "correspondence",
  "other",
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_SET: ReadonlySet<string> = new Set(DOCUMENT_CATEGORIES);

// Build a sanitised, length-bounded filename safe to embed in a storage key.
// Only word chars, dot and dash survive; everything else collapses to "_".
export function safeStorageName(filename: string): string {
  return filename.replace(/[^\w.\-]/g, "_").slice(0, 200);
}

// `file-type` reports some HEIC-family images as image/heif (the ISO-BMFF
// `mif1`/`msf1` brands) rather than image/heic. We only store the one HEIC
// variant, so normalise heif -> heic before comparing the declared and sniffed
// types. Returns null for empty input so callers can treat "no type" uniformly.
export function normaliseDocumentMime(mime: string | null | undefined): string | null {
  if (!mime) return null;
  if (mime === "image/heif") return "image/heic";
  return mime;
}

// Clean a user-supplied display name for a document rename: drop control
// characters, collapse whitespace runs, trim, and bound the length. Returns
// null when nothing usable remains so the caller can reject an empty rename.
// Unlike safeStorageName this KEEPS spaces and punctuation — the whole point of
// a rename is a human-readable label; the storage key is separate and unchanged.
export function cleanDocumentName(raw: string): string | null {
  const cleaned = raw
    .replace(/[\x00-\x1f\x7f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return cleaned.length ? cleaned : null;
}

// Trailing document/image extensions a user might type into the rename box.
// Used to strip a typed extension so it can't survive as part of the base name.
// Deliberately narrow: a name like "v1.2" or "report.2024" keeps its tail.
const TYPED_EXTENSION = /\.(pdf|jpe?g|png|heic|heif|webp|gif|tiff?|bmp)$/i;

// Compute the final stored name for a rename. The extension is NOT the user's
// to change: we clean their input, strip any document/image extension they
// typed (so re-typing or changing it can't produce "name.pdf.png"), then append
// the file's real extension — read from the current stored name. Returns null
// when no usable base remains (empty or extension-only input). When the current
// name has no extension, the cleaned input is returned unchanged.
export function forceExtension(rawName: string, currentName: string): string | null {
  const cleaned = cleanDocumentName(rawName);
  if (!cleaned) return null;
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(currentName)?.[1];
  if (!ext) return cleaned;
  const base = cleaned.replace(TYPED_EXTENSION, "").trim();
  return base ? `${base}.${ext}` : null;
}
