// Server-side content validation for uploaded patient documents.
//
// In the signed-URL upload flow the bytes go straight to Supabase Storage, so
// the ONLY place we get to inspect them is the finalize step, which downloads
// the stored object and runs it through here. We sniff the real type from the
// magic bytes rather than trusting the client-declared MIME (a renamed .exe or
// an HTML/SVG file would otherwise sail through). Detection is delegated to
// `file-type` — HEIC/WEBP are ISO-BMFF containers and hand-rolled signatures
// misdetect them.
//
// NOTE on the runtime: `file-type` is pinned to an exact version on purpose. We
// run on Node 20 while the lib declares node>=22; it uses no Node-22 APIs, but
// the pin stops a future 22.x patch from silently introducing one. The combo is
// verified by validate.test.ts running on Node 20 in CI.
import "server-only";
import { fileTypeFromBuffer } from "file-type";
import { ALLOWED_DOCUMENT_MIME_SET, normaliseDocumentMime } from "@/lib/documents/constants";

// Returns the normalised, sniffed MIME type, or null when the bytes could not
// be identified. `fileTypeFromBuffer` THROWS (not returns undefined) on some
// malformed/truncated inputs, so the throw is folded into the null result.
export async function sniffDocumentMime(bytes: Uint8Array): Promise<string | null> {
  try {
    const ft = await fileTypeFromBuffer(bytes);
    return normaliseDocumentMime(ft?.mime ?? null);
  } catch {
    return null;
  }
}

export type DocumentContentCheck =
  | { ok: true; mime: string }
  | { ok: false; code: "invalid_file_content" };

// Authoritative content check used by the finalize route. The bytes are valid
// only when the sniffed type is one we allow AND it agrees with what the client
// declared at upload time. Because the sniffed type must itself be in the
// allowed set, a matching declared type is implicitly an allowed type too.
export async function checkDocumentContent(
  bytes: Uint8Array,
  declaredMime: string | null | undefined,
): Promise<DocumentContentCheck> {
  const sniffed = await sniffDocumentMime(bytes);
  const declared = normaliseDocumentMime(declaredMime);
  if (!sniffed || !ALLOWED_DOCUMENT_MIME_SET.has(sniffed) || sniffed !== declared) {
    return { ok: false, code: "invalid_file_content" };
  }
  return { ok: true, mime: sniffed };
}
