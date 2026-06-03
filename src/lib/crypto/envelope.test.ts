import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import {
  decryptNoteBody, decryptNoteBytes, encryptNoteBody, encryptNoteBytes, generateDek, zero,
} from "./envelope";

describe("note envelope", () => {
  it("round-trips a text body", () => {
    const dek = generateDek();
    try {
      const { ciphertext, nonce } = encryptNoteBody(dek, "héllo — clinical note");
      expect(decryptNoteBody(dek, ciphertext, nonce)).toBe("héllo — clinical note");
    } finally {
      zero(dek);
    }
  });

  it("round-trips arbitrary bytes (e.g. a PNG) byte-identically", () => {
    const dek = generateDek();
    // Bytes that are NOT valid utf-8, to prove the binary path doesn't mangle them.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80, 0x7f]);
    try {
      const { ciphertext, nonce } = encryptNoteBytes(dek, png);
      expect(decryptNoteBytes(dek, ciphertext, nonce).equals(png)).toBe(true);
    } finally {
      zero(dek);
    }
  });

  it("uses a fresh nonce per encryption", () => {
    const dek = generateDek();
    try {
      const a = encryptNoteBytes(dek, Buffer.from("same"));
      const b = encryptNoteBytes(dek, Buffer.from("same"));
      expect(a.nonce.equals(b.nonce)).toBe(false);
      expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    } finally {
      zero(dek);
    }
  });
});
