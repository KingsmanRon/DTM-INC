import { describe, it, expect } from "vitest";
import { Buffer } from "node:buffer";
import { buildXlsx } from "./xlsx";

const ZIP_LOCAL_SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
const ZIP_EOCD_SIG = Buffer.from([0x50, 0x4b, 0x05, 0x06]); // PK\x05\x06

describe("buildXlsx", () => {
  const matrix = [
    ["File Number", "Patient Name", "ID / Passport Number"],
    ["NKA-2026-000123", "MBUYISWA J NHLAPO", "8001015009087"],
  ];

  it("produces a valid ZIP container (local + end-of-central-directory signatures)", () => {
    const buf = buildXlsx("Billing June 2026", matrix);
    expect(buf.subarray(0, 4)).toEqual(ZIP_LOCAL_SIG);
    expect(buf.includes(ZIP_EOCD_SIG)).toBe(true);
  });

  it("includes the required OOXML parts", () => {
    const buf = buildXlsx("Billing June 2026", matrix);
    const text = buf.toString("latin1"); // STORED entries appear verbatim
    expect(text).toContain("[Content_Types].xml");
    expect(text).toContain("xl/workbook.xml");
    expect(text).toContain("xl/worksheets/sheet1.xml");
    expect(text).toContain("xl/styles.xml");
  });

  it("writes cell values as inline strings with correct cell references", () => {
    const buf = buildXlsx("Billing June 2026", matrix);
    const text = buf.toString("latin1");
    expect(text).toContain('t="inlineStr"');
    expect(text).toContain('r="A1"');
    expect(text).toContain('r="C1"');
    expect(text).toContain('r="C2"');
    // Identifier survives verbatim — not coerced to a number.
    expect(text).toContain("8001015009087");
    expect(text).toContain("MBUYISWA J NHLAPO");
    expect(text).toContain('name="Billing June 2026"');
  });

  it("XML-escapes special characters", () => {
    const buf = buildXlsx("Sheet", [["A & B <x> \"q\""]]);
    const text = buf.toString("latin1");
    expect(text).toContain("A &amp; B &lt;x&gt; &quot;q&quot;");
    expect(text).not.toContain("<x>");
  });

  it("is deterministic (stable bytes for stable input)", () => {
    expect(buildXlsx("S", matrix)).toEqual(buildXlsx("S", matrix));
  });
});
