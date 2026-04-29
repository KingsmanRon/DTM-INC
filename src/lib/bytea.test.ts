import { describe, it, expect } from "vitest";
import { Buffer } from "node:buffer";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import {
  byteaToCryptoBuffer,
  cryptoBufferToByteaHex,
  cryptoBufferToBase64,
} from "./bytea";

describe("byteaToCryptoBuffer", () => {
  const cipherBytes = Buffer.from("deadbeefcafebabef00dd00d", "hex");

  it("passes raw Buffer through unchanged", () => {
    expect(byteaToCryptoBuffer(cipherBytes)).toEqual(cipherBytes);
  });

  it("passes Uint8Array through unchanged", () => {
    expect(byteaToCryptoBuffer(new Uint8Array(cipherBytes))).toEqual(cipherBytes);
  });

  it("decodes Postgres '\\x...' hex string", () => {
    expect(byteaToCryptoBuffer("\\xdeadbeefcafebabef00dd00d")).toEqual(cipherBytes);
  });

  it("decodes PostgREST/Supabase Base64 transport", () => {
    expect(byteaToCryptoBuffer(cipherBytes.toString("base64"))).toEqual(cipherBytes);
  });

  it("unwraps legacy Base64-text-inside-bytea (Buffer form)", () => {
    const legacy = Buffer.from(cipherBytes.toString("base64"), "utf8");
    expect(byteaToCryptoBuffer(legacy)).toEqual(cipherBytes);
  });

  it("unwraps legacy Base64-text-inside-bytea (PostgREST transport form)", () => {
    const inner = cipherBytes.toString("base64");
    const transport = Buffer.from(inner, "utf8").toString("base64");
    expect(byteaToCryptoBuffer(transport)).toEqual(cipherBytes);
  });

  it("matches production length: 60-byte wrapped DEK → 80 stored", () => {
    const dek = randomBytes(60);
    const legacy = Buffer.from(dek.toString("base64"), "utf8");
    expect(legacy.length).toBe(80);
    expect(byteaToCryptoBuffer(legacy)).toEqual(dek);
  });

  it("matches production length: 26-byte body → 36 stored", () => {
    const body = randomBytes(26);
    const legacy = Buffer.from(body.toString("base64"), "utf8");
    expect(legacy.length).toBe(36);
    expect(byteaToCryptoBuffer(legacy)).toEqual(body);
  });

  it("matches production length: 12-byte nonce → 16 stored", () => {
    const nonce = randomBytes(12);
    const legacy = Buffer.from(nonce.toString("base64"), "utf8");
    expect(legacy.length).toBe(16);
    expect(byteaToCryptoBuffer(legacy)).toEqual(nonce);
  });

  it("rejects unsupported types", () => {
    expect(() => byteaToCryptoBuffer(null)).toThrow("invalid_bytea_value");
    expect(() => byteaToCryptoBuffer(undefined)).toThrow("invalid_bytea_value");
    expect(() => byteaToCryptoBuffer(123)).toThrow("invalid_bytea_value");
    expect(() => byteaToCryptoBuffer({})).toThrow("invalid_bytea_value");
  });

  // Documents the heuristic limitation. After the one-shot migration the
  // legacy branch should be deleted and this test updated to assert the
  // input passes through unchanged.
  it("DOCUMENTED LIMITATION: ASCII-only buffers in Base64 alphabet are double-decoded", () => {
    const benign = Buffer.from("AAAA");
    expect(byteaToCryptoBuffer(benign)).toEqual(Buffer.from([0, 0, 0]));
  });
});

describe("cryptoBufferToByteaHex", () => {
  it("emits '\\x<hex>'", () => {
    expect(cryptoBufferToByteaHex(Buffer.from([0xde, 0xad, 0xbe, 0xef]))).toBe(
      "\\xdeadbeef"
    );
  });

  it("round-trips with byteaToCryptoBuffer", () => {
    const buf = randomBytes(32);
    expect(byteaToCryptoBuffer(cryptoBufferToByteaHex(buf))).toEqual(buf);
  });
});

describe("cryptoBufferToBase64", () => {
  it("round-trips through PostgREST-style Base64 transport", () => {
    const buf = randomBytes(32);
    expect(byteaToCryptoBuffer(cryptoBufferToBase64(buf))).toEqual(buf);
  });
});

describe("end-to-end: wrap DEK + encrypt note + bytea round trip + decrypt", () => {
  it("recovers plaintext through the full legacy storage path", () => {
    const kek = randomBytes(32);
    const dek = randomBytes(32);

    const dekIv = randomBytes(12);
    const dekCipher = createCipheriv("aes-256-gcm", kek, dekIv);
    const wrappedDek = Buffer.concat([
      dekCipher.update(dek),
      dekCipher.final(),
      dekCipher.getAuthTag(),
    ]);

    const noteIv = randomBytes(12);
    const noteCipher = createCipheriv("aes-256-gcm", dek, noteIv);
    const noteCt = Buffer.concat([
      noteCipher.update("Patient reports mild headache; BP 128/82.", "utf8"),
      noteCipher.final(),
    ]);
    const encryptedBody = Buffer.concat([noteCt, noteCipher.getAuthTag()]);

    // Simulate the legacy bug for all three columns: bytea contains the
    // Base64 text of the raw bytes.
    const legacyWrappedDek = Buffer.from(wrappedDek.toString("base64"), "utf8");
    const legacyBody = Buffer.from(encryptedBody.toString("base64"), "utf8");
    const legacyNonce = Buffer.from(noteIv.toString("base64"), "utf8");

    // Note: 12-byte nonces fall under the "ASCII-only buffers in Base64
    // alphabet are double-decoded" branch — the heuristic is needed.
    const recoveredWrapped = byteaToCryptoBuffer(legacyWrappedDek);
    const recoveredBody = byteaToCryptoBuffer(legacyBody);
    const recoveredNonce = byteaToCryptoBuffer(legacyNonce);

    const unwrapTag = recoveredWrapped.subarray(-16);
    const unwrapCt = recoveredWrapped.subarray(0, -16);
    const dekDecipher = createDecipheriv("aes-256-gcm", kek, dekIv);
    dekDecipher.setAuthTag(unwrapTag);
    const unwrappedDek = Buffer.concat([
      dekDecipher.update(unwrapCt),
      dekDecipher.final(),
    ]);
    expect(unwrappedDek).toEqual(dek);

    const bodyTag = recoveredBody.subarray(-16);
    const bodyCt = recoveredBody.subarray(0, -16);
    const noteDecipher = createDecipheriv("aes-256-gcm", unwrappedDek, recoveredNonce);
    noteDecipher.setAuthTag(bodyTag);
    const plaintext = Buffer.concat([
      noteDecipher.update(bodyCt),
      noteDecipher.final(),
    ]).toString("utf8");

    expect(plaintext).toBe("Patient reports mild headache; BP 128/82.");
  });
});
