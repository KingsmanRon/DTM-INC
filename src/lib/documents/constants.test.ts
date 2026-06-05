import { describe, expect, it } from "vitest";
import {
  ALLOWED_DOCUMENT_MIME_SET,
  cleanDocumentName,
  DOCUMENT_CATEGORY_SET,
  MAX_DOCUMENT_BYTES,
  normaliseDocumentMime,
  safeStorageName,
  withPreservedExtension,
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

describe("cleanDocumentName", () => {
  it("keeps spaces, hyphens and punctuation but collapses whitespace", () => {
    expect(cleanDocumentName("John  ID-copy")).toBe("John ID-copy");
    expect(cleanDocumentName("  Referral letter (Dr X)  ")).toBe("Referral letter (Dr X)");
  });

  it("strips control characters", () => {
    expect(cleanDocumentName("a" + String.fromCharCode(1) + "b")).toBe("a b");
    expect(cleanDocumentName("line1\nline2\tend")).toBe("line1 line2 end");
  });

  it("returns null when nothing usable remains", () => {
    expect(cleanDocumentName("")).toBeNull();
    expect(cleanDocumentName("   ")).toBeNull();
    expect(cleanDocumentName(String.fromCharCode(0) + String.fromCharCode(1))).toBeNull();
  });

  it("bounds the length to 200", () => {
    expect(cleanDocumentName("x".repeat(500))?.length).toBe(200);
  });
});

describe("withPreservedExtension", () => {
  it("appends the original extension when the new name lacks it", () => {
    expect(withPreservedExtension("John Smith ID copy", "Scan_20260605.png")).toBe("John Smith ID copy.png");
  });

  it("does not duplicate an extension that is already present (case-insensitive)", () => {
    expect(withPreservedExtension("report.png", "x.png")).toBe("report.png");
    expect(withPreservedExtension("report.PNG", "x.png")).toBe("report.PNG");
  });

  it("never mangles a dotted name that isn't the file extension", () => {
    expect(withPreservedExtension("v1.2", "x.png")).toBe("v1.2.png");
  });

  it("appends the real extension even if the user typed a different one", () => {
    expect(withPreservedExtension("scan.pdf", "x.png")).toBe("scan.pdf.png");
  });

  it("leaves the name untouched when the reference has no extension", () => {
    expect(withPreservedExtension("notes", "referencewithoutext")).toBe("notes");
  });
});
