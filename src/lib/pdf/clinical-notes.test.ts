import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { renderClinicalNotesPdf } from "./clinical-notes";

// Synthetic PNG keeps the image path covered without shipping a client's logo.
const REAL_PNG = await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } }).png().toBuffer();

describe("clinical notes PDF", () => {
  it("renders typed text, an embedded handwriting PNG, and a draft placeholder", async () => {
    const pdf = await renderClinicalNotesPdf({
      logo: REAL_PNG,
      practice: { name: "Test Practice", doctorName: "Dr Test", qualifications: "MBChB", practiceNumber: "123", address: "1 Test St", phone: "000" },
      fileNumber: "TEST-0001",
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
