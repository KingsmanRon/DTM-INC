// Bytea I/O helpers for envelope-encrypted clinical notes.
//
// All three crypto inputs (wrapped_dek, encrypted_body, nonce) are stored in
// Postgres `bytea` columns and accessed through PostgREST via supabase-js.
// Historical rows were written by passing `Buffer.toString("base64")` straight
// into the JSON payload; PostgREST forwarded the string unchanged and Postgres
// parsed it as bytea *escape* format (no `\x` prefix), which preserves each
// printable ASCII byte literally. The end result was bytea storing the UTF-8
// of the Base64 text — auth-tag verification then fails on decrypt.
//
// `byteaToCryptoBuffer` accepts every shape we have observed and returns the
// raw bytes the crypto code expects:
//
//   1. Buffer / Uint8Array               — node-postgres style (unused today)
//   2. "\x<hex>"                         — Postgres canonical text form
//   3. base64 string                     — PostgREST/Supabase JSON for new rows
//   4. base64 *bytes* inside a Buffer    — legacy bug, auto-unwrapped
//
// `cryptoBufferToByteaHex` produces the `\x<hex>` text form used for writes
// through supabase-js. Postgres autodetects the `\x` prefix and decodes hex
// regardless of caller — verified against Postgres bytea_input semantics
// (no special server config required).

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function looksLikeBase64Text(buf: Buffer): boolean {
  if (buf.length === 0 || buf.length % 4 !== 0) return false;
  // Cheap byte-level check first — every byte must be a printable Base64
  // character. Avoids a full UTF-8 decode for non-matching rows.
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i] as number;
    const isAlpha = (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a);
    const isDigit = b >= 0x30 && b <= 0x39;
    const isSym = b === 0x2b /* + */ || b === 0x2f /* / */ || b === 0x3d /* = */;
    if (!isAlpha && !isDigit && !isSym) return false;
  }
  return BASE64_RE.test(buf.toString("ascii"));
}

export function byteaToCryptoBuffer(value: unknown): Buffer {
  if (value == null) throw new Error("bytea: null/undefined value");

  if (Buffer.isBuffer(value)) {
    return looksLikeBase64Text(value) ? Buffer.from(value.toString("ascii"), "base64") : value;
  }
  if (value instanceof Uint8Array) {
    const buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    return looksLikeBase64Text(buf) ? Buffer.from(buf.toString("ascii"), "base64") : buf;
  }

  if (typeof value === "string") {
    if (value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
    if (BASE64_RE.test(value) && value.length % 4 === 0) return Buffer.from(value, "base64");
    throw new Error("bytea: unrecognised string encoding");
  }

  throw new Error(`bytea: unsupported value type ${typeof value}`);
}

export function cryptoBufferToByteaHex(buf: Buffer): string {
  return "\\x" + buf.toString("hex");
}
