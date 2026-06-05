import { describe, expect, it } from "vitest";
import {
  ALLOWED_DOCUMENT_MIME_SET,
  DOCUMENT_CATEGORY_SET,
  MAX_DOCUMENT_BYTES,
  normaliseDocumentMime,
  safeStorageName,
} from "./constants";

describe("document constants", () => {
  it("caps uploads at 25 MB", () => {
    expect(MAX_DOCUMENT_BYTES).toBe(26214400);
  });

  it("allows exactly the five accepted MIME types", () => {
    expect([...ALLOWED_DOCUMENT_MIME_SET].sort()).toEqual(
      ["application/pdf", "image/heic", "image/jpeg", "image/png", "image/webp"].sort(),
    );
  });

  it("knows the eight document categories", () => {
    expect(DOCUMENT_CATEGORY_SET.has("id_copy")).toBe(true);
    expect(DOCUMENT_CATEGORY_SET.has("other")).toBe(true);
    expect(DOCUMENT_CATEGORY_SET.has("not_a_category")).toBe(false);
  });
});

describe("normaliseDocumentMime", () => {
  it("maps the HEIC heif-family variant onto image/heic", () => {
    expect(normaliseDocumentMime("image/heif")).toBe("image/heic");
  });

  it("passes through other types and nulls empty input", () => {
    expect(normaliseDocumentMime("image/png")).toBe("image/png");
    expect(normaliseDocumentMime("")).toBeNull();
    expect(normaliseDocumentMime(null)).toBeNull();
    expect(normaliseDocumentMime(undefined)).toBeNull();
  });
});

describe("safeStorageName", () => {
  it("collapses unsafe characters and bounds the length", () => {
    expect(safeStorageName("Scan 2026/06/05 (final).png")).toBe("Scan_2026_06_05__final_.png");
    expect(safeStorageName("a".repeat(500)).length).toBe(200);
    expect(safeStorageName("../../etc/passwd")).toBe(".._.._etc_passwd");
  });
});
