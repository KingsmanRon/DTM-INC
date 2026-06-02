import { describe, expect, it } from "vitest";
import { decryptNoteInk, encryptNoteInk, generateDek, zero } from "@/lib/crypto/envelope";
import { MAX_INK_BYTES, parseInkPayload } from "./ink";

const ink = JSON.stringify({ version: 1, pages: [{ strokes: [[[12.25, 18.5, 0.4], [13, 19, 0.8]]] }] });

describe("handwritten clinical note ink", () => {
  it("round-trips ink byte-identically with the patient DEK path", () => {
    const dek = generateDek();
    try {
      const encrypted = encryptNoteInk(dek, ink);
      expect(Buffer.from(decryptNoteInk(dek, encrypted.ciphertext, encrypted.nonce), "utf8")).toEqual(Buffer.from(ink, "utf8"));
    } finally {
      zero(dek);
    }
  });

  it("accepts valid ink documents", () => {
    expect(parseInkPayload(ink).pages[0]!.strokes).toHaveLength(1);
  });

  it("rejects ink documents larger than the ink-specific limit", () => {
    expect(() => parseInkPayload("x".repeat(MAX_INK_BYTES + 1))).toThrow("ink_too_large");
  });

  it("rejects empty ink documents", () => {
    expect(() => parseInkPayload(JSON.stringify({ version: 1, pages: [{ strokes: [] }] }))).toThrow("invalid_ink");
  });
});
