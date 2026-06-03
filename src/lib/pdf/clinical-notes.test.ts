import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderClinicalNotesPdf } from "./clinical-notes";

// Use a real PNG (the brand logo) so the image-embed path is genuinely
// exercised; canvas.toBlob() produces the same kind of standard PNG at runtime.
const REAL_PNG = fs.readFileSync(
  path.join(process.cwd(), "public", "brand", "Dr. T. Mtshali_LOGO - PDF.png"),
);

describe("clinical notes PDF", () => {
  it("renders typed text, an embedded handwriting PNG, and a draft placeholder", async () => {
    const pdf = await renderClinicalNotesPdf({
      practice: { name: "Test Practice", doctorName: "Dr Test", qualifications: "MBChB", practiceNumber: "123", address: "1 Test St", phone: "000" },
      fileNumber: "DTM-0001",
      patientName: "Jane Doe",
      notes: [
        { note_date: "2026-06-03", is_finalised: true, body: "Line one\nLine two", inkPng: null, hasInk: false },
        { note_date: "2026-06-02", is_finalised: true, body: "", inkPng: REAL_PNG, hasInk: true },
        { note_date: "2026-06-01", is_finalised: false, body: "", inkPng: null, hasInk: true },
      ],
    });
    expect(pdf.length).toBeGreaterThan(0);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
