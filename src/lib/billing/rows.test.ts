import { describe, it, expect } from "vitest";
import { buildBillingRows, medicalAidCell, type BillingItem } from "./rows";
import { BILLING_COLUMNS, CASH_PAYER_LABEL } from "./format";

const sample: BillingItem = {
  file_number: "NKA-2026-000123",
  patient_name: "MBUYISWA J NHLAPO",
  id_number: "8001015009087",
  medical_aid_number: "MA-998877",
  payer_type: "medical_aid",
  outgoing_date: "2026-06-03",
  returned_date: null,
};

// Build the rows and return the single data row (row index 1), narrowed.
function firstDataRow(item: BillingItem): string[] {
  const rows = buildBillingRows([item]);
  const row = rows[1];
  if (!row) throw new Error("expected a data row");
  return row;
}

describe("buildBillingRows", () => {
  it("emits the header row in column order", () => {
    const rows = buildBillingRows([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual([...BILLING_COLUMNS]);
  });

  it("POPULATES ID/Passport and Medical Aid Number (they must not be blank)", () => {
    const row = firstDataRow(sample);
    // Columns: File, Name, ID/Passport, Medical Aid, Outgoing, Returned
    expect(row[0]).toBe("NKA-2026-000123");
    expect(row[1]).toBe("MBUYISWA J NHLAPO");
    expect(row[2]).toBe("8001015009087");
    expect(row[3]).toBe("MA-998877");
    expect(row[2]).not.toBe("");
    expect(row[3]).not.toBe("");
  });

  it("formats the outgoing date and leaves a missing returned date blank", () => {
    const row = firstDataRow(sample);
    expect(row[4]).toBe("03 JUNE 2026");
    expect(row[5]).toBe("");
  });

  it("formats a returned date when present", () => {
    const row = firstDataRow({ ...sample, returned_date: "2026-06-20" });
    expect(row[5]).toBe("20 JUNE 2026");
  });

  it("renders blanks for genuinely missing identifiers (e.g. a minor without an ID)", () => {
    const row = firstDataRow({ ...sample, id_number: null, medical_aid_number: null, file_number: null });
    expect(row[0]).toBe("");
    expect(row[2]).toBe("");
    expect(row[3]).toBe("");
  });
});

describe("cash (private payer) semantics in the Medical Aid Number column", () => {
  it("writes CASH for a private payer with no medical aid captured", () => {
    const row = firstDataRow({ ...sample, payer_type: "private", medical_aid_number: null });
    expect(row[3]).toBe(CASH_PAYER_LABEL);
  });

  it("payer type is authoritative: CASH even over a stale snapshotted number", () => {
    // Patient had medical aid, dropped it, was flipped to private; the old
    // membership number may still be on the medical-aid record. The billing
    // company must not claim against a dead scheme.
    const row = firstDataRow({ ...sample, payer_type: "private", medical_aid_number: "MA-998877" });
    expect(row[3]).toBe(CASH_PAYER_LABEL);
  });

  it("keeps blank reserved for a medical-aid patient with a missing number", () => {
    const row = firstDataRow({ ...sample, payer_type: "medical_aid", medical_aid_number: null });
    expect(row[3]).toBe("");
  });

  it("legacy rows (payer unknown, staged pre-0041) keep the old number-or-blank rendering", () => {
    expect(medicalAidCell({ payer_type: null, medical_aid_number: "MA-998877" })).toBe("MA-998877");
    expect(medicalAidCell({ payer_type: null, medical_aid_number: null })).toBe("");
  });

  it("never lets CASH collide with a real membership number rendering", () => {
    // The label is a fixed sentinel, not derived from patient data.
    expect(CASH_PAYER_LABEL).toBe("CASH");
    expect(medicalAidCell({ payer_type: "medical_aid", medical_aid_number: "CASH-123" })).toBe("CASH-123");
  });
});
