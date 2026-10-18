// Request signing for the ACCESS integration (docs/integrations/access.md).
//
// ACCESS signs every request with a shared secret it holds only in its
// worker. DTM recomputes the signature and refuses anything that does not
// match, is older or newer than five minutes, or names an unknown key.
//
// The canonical string is the contract: ACCESS builds exactly the same
// bytes (apps/worker/src/dtm-signature.ts in KingsmanRon/Appointments), and
// both repositories test against the same fixed vector. Changing any part of
// it needs a new version prefix on both sides.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_SCHEME = "access-dtm-v1";
export const MAX_CLOCK_SKEW_SECONDS = 300;

export const HEADER_KEY_ID = "x-access-key-id";
export const HEADER_TIMESTAMP = "x-access-timestamp";
export const HEADER_SIGNATURE = "x-access-signature";

export function sha256Hex(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/** The exact text both sides sign, one field per line. */
export function canonicalRequest(input: {
  method: string;
  pathWithQuery: string;
  timestamp: string;
  bodySha256: string;
}): string {
  return [
    SIGNATURE_SCHEME,
    input.method.toUpperCase(),
    input.pathWithQuery,
    input.timestamp,
    input.bodySha256,
  ].join("\n");
}

/** `v1=<hex HMAC-SHA256>` of the canonical request. */
export function signCanonical(secret: string, canonical: string): string {
  return `v1=${createHmac("sha256", secret).update(canonical, "utf8").digest("hex")}`;
}

export type VerifyFailure =
  | "missing_headers"
  | "unknown_key"
  | "bad_timestamp"
  | "stale_timestamp"
  | "bad_signature";

export type VerifyResult = { ok: true; keyId: string } | { ok: false; reason: VerifyFailure };

const SIGNATURE_FORMAT = /^v1=[0-9a-f]{64}$/;
const TIMESTAMP_FORMAT = /^\d{10}$/;

export function verifySignature(input: {
  method: string;
  pathWithQuery: string;
  keyId: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  keys: ReadonlyMap<string, string>;
  now: Date;
}): VerifyResult {
  const { keyId, timestamp, signature } = input;
  if (!keyId || !timestamp || !signature) return { ok: false, reason: "missing_headers" };
  const secret = input.keys.get(keyId);
  if (!secret) return { ok: false, reason: "unknown_key" };
  if (!TIMESTAMP_FORMAT.test(timestamp)) return { ok: false, reason: "bad_timestamp" };
  const skew = Math.abs(Math.floor(input.now.getTime() / 1000) - Number(timestamp));
  if (skew > MAX_CLOCK_SKEW_SECONDS) return { ok: false, reason: "stale_timestamp" };
  if (!SIGNATURE_FORMAT.test(signature)) return { ok: false, reason: "bad_signature" };

  const expected = signCanonical(
    secret,
    canonicalRequest({
      method: input.method,
      pathWithQuery: input.pathWithQuery,
      timestamp,
      bodySha256: sha256Hex(input.body),
    })
  );
  // Same length is guaranteed by the format check; compare in constant time.
  const matches = timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(signature, "utf8"));
  return matches ? { ok: true, keyId } : { ok: false, reason: "bad_signature" };
}
