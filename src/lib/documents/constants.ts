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

// Keep a renamed file openable by carrying over the original extension. Appends
// `reference`'s extension to `name` only when `name` doesn't already end with
// that same extension (case-insensitive). Never strips or rewrites an extension
// the user typed, so a name like "v1.2" is left intact (gains the real ext).
export function withPreservedExtension(name: string, reference: string): string {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(reference)?.[1];
  if (!ext) return name;
  const alreadyHasExt = new RegExp(`\\.${ext}$`, "i").test(name);
  return alreadyHasExt ? name : `${name}.${ext}`;
}
