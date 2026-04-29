// Bytea I/O helpers for envelope-encrypted clinical notes.
//
// Background. All three crypto inputs (wrapped_dek, encrypted_body, nonce)
// live in Postgres `bytea` columns and are accessed through PostgREST via
// supabase-js. Historical writes called `Buffer.toString("base64")` and the
// resulting string was stored in the bytea column as escape-format text —
// each ASCII byte preserved verbatim. The end result is bytea holding the
// UTF-8 of the Base64 representation, so AES-GCM auth-tag verification fails
// on every read.
//
// `byteaToCryptoBuffer` accepts the four shapes the route can encounter:
//   1. Buffer / Uint8Array       — node-postgres bytea representation
//   2. "\\x<hex>"                — Postgres canonical text form
//   3. Base64 string             — PostgREST/Supabase JSON transport
//   4. Base64 text inside bytea  — legacy bug, auto-unwrapped via heuristic
//
// `cryptoBufferToBase64` is the writer for the supabase-js / PostgREST path.
// `cryptoBufferToByteaHex` is reserved for raw-SQL drivers (node-postgres)
// where the `\\x<hex>` literal is parsed by Postgres itself; it MUST NOT be
// used through PostgREST or the literal string ends up stored verbatim.

import { Buffer } from "node:buffer";

/**
 * Heuristic: does this Buffer's UTF-8 representation look like Base64 text?
 *
 * False-positive probability for raw cipher bytes is bounded by (64/256)^N,
 * roughly 6e-8 for a 12-byte nonce and ~1e-36 for a 60-byte wrapped DEK.
 * The fast-path ASCII check eliminates almost all binary cases before regex.
 */
function looksLikeBase64Text(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  for (let i = 0; i < buf.length; i++) {
    if ((buf[i] as number) >= 0x80) return false;
  }
  const text = buf.toString("utf8").trim();
  return (
    text.length > 0 &&
    text.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(text)
  );
}

export function byteaToCryptoBuffer(value: unknown): Buffer {
  let raw: Buffer;

  if (Buffer.isBuffer(value)) {
    raw = Buffer.from(value);
  } else if (value instanceof Uint8Array) {
    raw = Buffer.from(value);
  } else if (typeof value === "string") {
    raw = value.startsWith("\\x")
      ? Buffer.from(value.slice(2), "hex")
      : Buffer.from(value, "base64");
  } else {
    throw new Error("invalid_bytea_value");
  }

  if (looksLikeBase64Text(raw)) {
    return Buffer.from(raw.toString("utf8"), "base64");
  }
  return raw;
}

/**
 * Postgres bytea hex literal: '\\x<hex>'.
 *
 * Use ONLY with raw SQL drivers (node-postgres) where this string is cast to
 * bytea by Postgres itself. Do NOT use through Supabase JS / PostgREST — the
 * literal would be stored byte-for-byte and recreate the original bug.
 */
export function cryptoBufferToByteaHex(buf: Buffer): string {
  return `\\x${buf.toString("hex")}`;
}

/**
 * Base64 string for PostgREST / Supabase JSON inserts to bytea columns.
 * PostgREST 11+ accepts Base64 in JSON for bytea natively.
 */
export function cryptoBufferToBase64(buf: Buffer): string {
  return buf.toString("base64");
}
