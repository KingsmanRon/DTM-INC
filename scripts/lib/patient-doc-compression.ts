// Shared helpers for the patient-document image-compression backfill, rollback
// and original-cleanup CLIs. Server-side / service-role only — NEVER bundled
// into the app. The service-role key is read from the environment and is never
// logged or echoed.
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { safeStorageName } from "../../src/lib/documents/constants";

export const BUCKET = "patient-documents";
export const COMPRESSION_VERSION = "v1";

// Input image types the backfill will touch. WebP is deliberately ABSENT: it is
// our output format, and a source already-webp object is left alone.
export const COMPRESSIBLE_IMAGE_MIME: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/heic",
];

// Text-critical categories carry small, legally-significant text (ID numbers,
// pathology values). They get near-lossless treatment and are exempt from the
// aggressive downscale retry tier — an automated quality loop must never be the
// thing that decides whether a digit is still readable (spec §2, §3).
export const TEXT_CRITICAL_CATEGORIES: ReadonlySet<string> = new Set([
  "id_copy",
  "pathology_result",
]);

// Compression defaults (spec §3).
export const DEFAULT_MAX_DIMENSION = 2200;
export const DEFAULT_QUALITY = 82;
export const RETRY_QUALITY = 78;
export const RETRY_MAX_DIMENSION = 1800;
export const RETRY_TRIGGER_BYTES = 5 * 1024 * 1024; // retry if first pass > 5 MB
export const TEXT_CRITICAL_QUALITY = 90; // near-lossless floor for text categories
export const WEBP_EFFORT = 6; // sharp webp effort: 0..6, 6 = highest

// ── Env + client ────────────────────────────────────────────────────────────

export type RequiredEnv = {
  url: string;
  serviceRoleKey: string;
};

// Fail fast and loud if the service-role credentials are absent. We read the
// same vars the app uses (src/lib/env.ts) but never validate the whole app env
// here — this is standalone tooling.
export function requireEnv(): RequiredEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return { url, serviceRoleKey };
}

export function getAdminClient(): SupabaseClient {
  const { url, serviceRoleKey } = requireEnv();
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ── Hashing ─────────────────────────────────────────────────────────────────

export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// ── Compression (spec §3) ───────────────────────────────────────────────────

export type CompressionTier =
  | "default"
  | "default-retry"
  | "text-critical-lossless"
  | "text-critical-nearlossless";

export type CompressionOutcome =
  | {
      kind: "compressed";
      buffer: Buffer;
      size: number;
      sha256: string;
      quality: number;
      tier: CompressionTier;
      width: number;
      height: number;
    }
  | {
      // The compressed result was not smaller than the original — keep the
      // original, mark the row 'skipped'. Never swap to a larger object.
      kind: "skipped-larger";
      attemptedSize: number;
    };

type EncodeResult = { buffer: Buffer; width: number; height: number; quality: number };

// Encode one WebP candidate. `.rotate()` is called FIRST with no args so the
// EXIF orientation is baked into the pixels before sharp strips metadata on
// conversion — reverse this order and portrait scans render sideways (spec §3).
async function encodeWebp(
  input: Buffer,
  opts: { maxDimension: number; quality: number; lossless?: boolean; nearLossless?: boolean },
): Promise<EncodeResult> {
  const pipeline = sharp(input)
    .rotate()
    .resize({
      width: opts.maxDimension,
      height: opts.maxDimension,
      fit: "inside",
      withoutEnlargement: true, // never upscale
    });

  const webpOptions: sharp.WebpOptions = { effort: WEBP_EFFORT, quality: opts.quality };
  if (opts.lossless) webpOptions.lossless = true;
  if (opts.nearLossless) webpOptions.nearLossless = true;

  const { data, info } = await pipeline.webp(webpOptions).toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height, quality: opts.quality };
}

function asOutcome(
  encoded: EncodeResult,
  originalSize: number,
  tier: CompressionTier,
): CompressionOutcome {
  if (encoded.buffer.length >= originalSize) {
    return { kind: "skipped-larger", attemptedSize: encoded.buffer.length };
  }
  return {
    kind: "compressed",
    buffer: encoded.buffer,
    size: encoded.buffer.length,
    sha256: sha256Hex(encoded.buffer),
    quality: encoded.quality,
    tier,
    width: encoded.width,
    height: encoded.height,
  };
}

// Produce the compressed WebP for a document, applying the category-specific
// policy. Pure function of (bytes, category) — no I/O — so it is unit-testable
// and dry-run uses the exact same code path the real run does (spec §5).
export async function compressDocumentImage(
  input: Buffer,
  category: string,
  originalSize: number,
): Promise<CompressionOutcome> {
  if (TEXT_CRITICAL_CATEGORIES.has(category)) {
    // Near-lossless: try true lossless first; if it is not larger than the
    // original keep it (lossless WebP frequently beats a source PNG outright).
    // Otherwise fall back to near-lossless quality 90. NEVER downscale to hit a
    // size target here — keep it large or skip.
    const lossless = await encodeWebp(input, {
      maxDimension: DEFAULT_MAX_DIMENSION,
      quality: 100,
      lossless: true,
    });
    if (lossless.buffer.length < originalSize) {
      return asOutcome(lossless, originalSize, "text-critical-lossless");
    }
    const nearLossless = await encodeWebp(input, {
      maxDimension: DEFAULT_MAX_DIMENSION,
      quality: TEXT_CRITICAL_QUALITY,
      nearLossless: true,
    });
    return asOutcome(nearLossless, originalSize, "text-critical-nearlossless");
  }

  // Default categories: lossy q82 at 2200 px.
  const first = await encodeWebp(input, {
    maxDimension: DEFAULT_MAX_DIMENSION,
    quality: DEFAULT_QUALITY,
  });

  // Retry tier: still heavy (> 5 MB) -> q78 at 1800 px. Pick the smaller of the
  // two valid (smaller-than-original) candidates.
  if (first.buffer.length > RETRY_TRIGGER_BYTES) {
    const retry = await encodeWebp(input, {
      maxDimension: RETRY_MAX_DIMENSION,
      quality: RETRY_QUALITY,
    });
    const best = retry.buffer.length < first.buffer.length ? retry : first;
    const tier = best === retry ? "default-retry" : "default";
    return asOutcome(best, originalSize, tier);
  }

  return asOutcome(first, originalSize, "default");
}

// ── Storage paths + I/O ─────────────────────────────────────────────────────

// {patient_id}/{document_id}/compressed/v1/{safe_filename}.webp — a NEW path;
// the original object is never overwritten (spec §4).
export function buildCompressedPath(
  patientId: string,
  documentId: string,
  originalFilename: string,
): string {
  const base = safeStorageName(originalFilename).replace(/\.[A-Za-z0-9]{1,8}$/, "") || "document";
  return `${patientId}/${documentId}/compressed/${COMPRESSION_VERSION}/${base}.webp`;
}

export async function downloadObject(client: SupabaseClient, key: string): Promise<Buffer> {
  const { data, error } = await client.storage.from(BUCKET).download(key);
  if (error || !data) throw new Error(`download failed for ${key}: ${error?.message ?? "no data"}`);
  const arrayBuf = await data.arrayBuffer();
  return Buffer.from(arrayBuf);
}

export async function objectExists(client: SupabaseClient, key: string): Promise<boolean> {
  // download() is the only reliable existence check for a private bucket object
  // by exact key; list() globs a prefix and is racy for our purpose.
  const { data, error } = await client.storage.from(BUCKET).download(key);
  return Boolean(data) && !error;
}

// Upload with upsert so a resumed run re-uploading to the same v1 path is
// idempotent and never collides (spec §4 step 2/5).
export async function uploadCompressed(
  client: SupabaseClient,
  key: string,
  buffer: Buffer,
): Promise<void> {
  const { error } = await client.storage
    .from(BUCKET)
    .upload(key, buffer, { contentType: "image/webp", upsert: true });
  if (error) throw new Error(`upload failed for ${key}: ${error.message}`);
}

// Verify-by-round-trip (spec §4 step 6, design decision #5): re-fetch the object
// we just uploaded, confirm it decodes as a valid image, and confirm its bytes
// hash to exactly what we intended to upload. Hashing the local buffer would
// prove nothing about the upload.
export async function verifyRoundTrip(
  client: SupabaseClient,
  key: string,
  intendedSha256: string,
): Promise<{ ok: true; width: number; height: number } | { ok: false; reason: string }> {
  let fetched: Buffer;
  try {
    fetched = await downloadObject(client, key);
  } catch (err) {
    return { ok: false, reason: `re-fetch failed: ${(err as Error).message}` };
  }
  if (sha256Hex(fetched) !== intendedSha256) {
    return { ok: false, reason: "re-fetched bytes do not match intended sha256" };
  }
  try {
    const meta = await sharp(fetched).metadata();
    if (!meta.width || !meta.height || meta.width < 1 || meta.height < 1) {
      return { ok: false, reason: "decoded image has no sane dimensions" };
    }
    return { ok: true, width: meta.width, height: meta.height };
  } catch (err) {
    return { ok: false, reason: `decode failed: ${(err as Error).message}` };
  }
}

// Re-fetch an object and confirm it decodes as a valid image with sane
// dimensions. Used by the cleanup script's "compressed object currently
// verifies at delete time" guard (spec §9) — we never delete an original whose
// compressed replacement no longer reads back as a real image.
export async function decodesAsValidImage(
  client: SupabaseClient,
  key: string,
): Promise<{ ok: true; width: number; height: number } | { ok: false; reason: string }> {
  let fetched: Buffer;
  try {
    fetched = await downloadObject(client, key);
  } catch (err) {
    return { ok: false, reason: `re-fetch failed: ${(err as Error).message}` };
  }
  try {
    const meta = await sharp(fetched).metadata();
    if (!meta.width || !meta.height || meta.width < 1 || meta.height < 1) {
      return { ok: false, reason: "decoded image has no sane dimensions" };
    }
    return { ok: true, width: meta.width, height: meta.height };
  } catch (err) {
    return { ok: false, reason: `decode failed: ${(err as Error).message}` };
  }
}

// ── Row shape ───────────────────────────────────────────────────────────────

export type DocumentRow = {
  id: string;
  patient_id: string;
  category: string;
  storage_key: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  sha256_hash: string;
  archived_at: string | null;
  compression_status: string;
  original_storage_key: string | null;
  original_file_size: number | null;
  original_sha256_hash: string | null;
  original_mime_type: string | null;
  compressed_at: string | null;
};

export const DOCUMENT_ROW_COLUMNS =
  "id, patient_id, category, storage_key, original_filename, mime_type, file_size, " +
  "sha256_hash, archived_at, compression_status, original_storage_key, " +
  "original_file_size, original_sha256_hash, original_mime_type, compressed_at";

// ── Formatting ──────────────────────────────────────────────────────────────

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function pct(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  return `${(((whole - part) / whole) * 100).toFixed(1)}%`;
}
