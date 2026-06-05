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
