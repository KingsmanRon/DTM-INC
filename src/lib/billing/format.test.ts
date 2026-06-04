import { describe, it, expect } from "vitest";
import {
  assemblePatientName,
  billingFilename,
  firstDayToMonthInput,
  formatBillingDate,
  hospitalSlug,
  monthInputToFirstDay,
  monthLabel,
} from "./format";

describe("monthInputToFirstDay", () => {
  it("maps YYYY-MM to the first day of the month", () => {
    expect(monthInputToFirstDay("2026-06")).toBe("2026-06-01");
    expect(monthInputToFirstDay("2026-01")).toBe("2026-01-01");
    expect(monthInputToFirstDay("2026-12")).toBe("2026-12-01");
  });
  it("rejects malformed or out-of-range input", () => {
    expect(monthInputToFirstDay("2026-13")).toBeNull();
    expect(monthInputToFirstDay("2026-00")).toBeNull();
    expect(monthInputToFirstDay("2026/06")).toBeNull();
    expect(monthInputToFirstDay("nope")).toBeNull();
  });
});

describe("firstDayToMonthInput", () => {
  it("maps a first-of-month date back to the month input", () => {
    expect(firstDayToMonthInput("2026-06-01")).toBe("2026-06");
  });
});

describe("formatBillingDate", () => {
  it("formats as DD MMMM YYYY with an upper-case month", () => {
    expect(formatBillingDate("2026-06-03")).toBe("03 JUNE 2026");
    expect(formatBillingDate("2026-12-25")).toBe("25 DECEMBER 2026");
  });
  it("keeps a blank/absent date blank (does not invent one)", () => {
    expect(formatBillingDate("")).toBe("");
    expect(formatBillingDate(null)).toBe("");
    expect(formatBillingDate(undefined)).toBe("");
  });
  it("does not shift the day regardless of host time zone", () => {
    // Parsed by parts, never new Date(str) — so the 1st stays the 1st.
    expect(formatBillingDate("2026-06-01")).toBe("01 JUNE 2026");
  });
});

describe("monthLabel", () => {
  it("renders a friendly Month Year label", () => {
    expect(monthLabel("2026-06")).toBe("June 2026");
    expect(monthLabel("2026-06-01")).toBe("June 2026");
  });
});

describe("assemblePatientName", () => {
  it("preserves middle names / initials (the sample artifact has them)", () => {
    expect(assemblePatientName("MBUYISWA J", "NHLAPO")).toBe("MBUYISWA J NHLAPO");
    expect(assemblePatientName("DANIEL K", "MOFOKENG")).toBe("DANIEL K MOFOKENG");
  });
  it("collapses stray whitespace", () => {
    expect(assemblePatientName("  Ann   Marie ", " Smith ")).toBe("Ann Marie Smith");
  });
  it("tolerates nulls", () => {
    expect(assemblePatientName(null, "Smith")).toBe("Smith");
    expect(assemblePatientName("Ann", null)).toBe("Ann");
  });
});

describe("hospitalSlug / billingFilename", () => {
  it("strips hospital suffixes and slugifies long names", () => {
    expect(hospitalSlug("Nkanyezi Private Hospital")).toBe("nkanyezi");
    expect(hospitalSlug("Mediclinic Vereeniging Hospital")).toBe("mediclinic-vereeniging");
    expect(hospitalSlug("Fountain Private Hospital")).toBe("fountain");
    expect(hospitalSlug("Midvaal Private Hospital")).toBe("midvaal");
  });
  it("builds the export filename", () => {
    expect(billingFilename("Nkanyezi Private Hospital", "2026-06")).toBe(
      "billing-export-nkanyezi-2026-06.xlsx",
    );
    expect(billingFilename("Mediclinic Vereeniging Hospital", "2026-06-01")).toBe(
      "billing-export-mediclinic-vereeniging-2026-06.xlsx",
    );
  });
});
