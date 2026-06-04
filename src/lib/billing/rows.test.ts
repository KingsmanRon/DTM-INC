import { describe, it, expect } from "vitest";
import { buildBillingRows, type BillingItem } from "./rows";
import { BILLING_COLUMNS } from "./format";

const sample: BillingItem = {
  file_number: "NKA-2026-000123",
  patient_name: "MBUYISWA J NHLAPO",
  id_number: "8001015009087",
  medical_aid_number: "MA-998877",
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
