import { describe, expect, it } from "vitest";
import {
  ALLOWED_DOCUMENT_MIME_SET,
  cleanDocumentName,
  DOCUMENT_CATEGORY_SET,
  forceExtension,
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

describe("forceExtension", () => {
  it("appends the file's real extension when none is typed", () => {
    expect(forceExtension("John Smith ID copy", "Scan_20260605.png")).toBe("John Smith ID copy.png");
  });

  it("keeps a single extension when the user retypes the real one", () => {
    expect(forceExtension("report.png", "x.png")).toBe("report.png");
    expect(forceExtension("report.PNG", "x.png")).toBe("report.png");
  });

  it("forces the real extension when the user types a different one — no double", () => {
    expect(forceExtension("scan.pdf", "x.png")).toBe("scan.png");
    expect(forceExtension("report.jpg", "photo.png")).toBe("report.png");
  });

  it("leaves a non-extension dotted tail intact", () => {
    expect(forceExtension("v1.2", "x.png")).toBe("v1.2.png");
    expect(forceExtension("Visit 2024.report", "x.png")).toBe("Visit 2024.report.png");
  });

  it("returns null for empty or extension-only input", () => {
    expect(forceExtension("", "x.png")).toBeNull();
    expect(forceExtension("   ", "x.png")).toBeNull();
    expect(forceExtension(".png", "x.png")).toBeNull();
  });

  it("returns the cleaned name unchanged when the current file has no extension", () => {
    expect(forceExtension("notes", "referencewithoutext")).toBe("notes");
  });
});
