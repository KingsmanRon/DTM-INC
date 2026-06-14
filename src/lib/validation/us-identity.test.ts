import { describe, it, expect } from "vitest";
import { isPlausibleDob, UsPatientIdentity, usIdentityDedupeKey } from "./us-identity";

describe("isPlausibleDob", () => {
  it("accepts a real past date", () => {
    expect(isPlausibleDob("1985-07-21")).toBe(true);
    expect(isPlausibleDob("2000-02-29")).toBe(true); // leap year
  });
  it("rejects bad formats", () => {
    expect(isPlausibleDob("21-07-1985")).toBe(false);
    expect(isPlausibleDob("1985-7-21")).toBe(false);
    expect(isPlausibleDob("")).toBe(false);
  });
  it("rejects impossible calendar dates", () => {
    expect(isPlausibleDob("2021-02-30")).toBe(false);
    expect(isPlausibleDob("2021-13-01")).toBe(false);
    expect(isPlausibleDob("2019-02-29")).toBe(false); // not a leap year
  });
  it("rejects future dates and >120 years", () => {
    expect(isPlausibleDob("2999-01-01")).toBe(false);
    expect(isPlausibleDob("1850-01-01")).toBe(false);
  });
});

describe("UsPatientIdentity", () => {
  const base = { first_names: "Jane", surname: "Doe", date_of_birth: "1990-03-15" };

  it("accepts a valid identity with no SSN", () => {
    expect(UsPatientIdentity.safeParse(base).success).toBe(true);
    expect(UsPatientIdentity.safeParse({ ...base, ssn_last4: "" }).success).toBe(true);
  });
  it("accepts a valid 4-digit SSN last-4", () => {
    expect(UsPatientIdentity.safeParse({ ...base, ssn_last4: "1234" }).success).toBe(true);
  });
  it("rejects an SSN that is not exactly 4 digits", () => {
    expect(UsPatientIdentity.safeParse({ ...base, ssn_last4: "123" }).success).toBe(false);
    expect(UsPatientIdentity.safeParse({ ...base, ssn_last4: "12345" }).success).toBe(false);
    expect(UsPatientIdentity.safeParse({ ...base, ssn_last4: "12a4" }).success).toBe(false);
  });
  it("requires name and a valid DOB", () => {
    expect(UsPatientIdentity.safeParse({ ...base, first_names: "" }).success).toBe(false);
    expect(UsPatientIdentity.safeParse({ ...base, date_of_birth: "not-a-date" }).success).toBe(false);
  });
});

describe("usIdentityDedupeKey", () => {
  it("normalises case and whitespace so trivial variants collide", () => {
    const a = usIdentityDedupeKey({ first_names: "  Jane ", surname: "Doe", date_of_birth: "1990-03-15" });
    const b = usIdentityDedupeKey({ first_names: "jane", surname: "  DOE  ", date_of_birth: "1990-03-15" });
    expect(a).toBe(b);
  });
  it("separates different people", () => {
    const a = usIdentityDedupeKey({ first_names: "Jane", surname: "Doe", date_of_birth: "1990-03-15" });
    const b = usIdentityDedupeKey({ first_names: "Jane", surname: "Doe", date_of_birth: "1991-03-15" });
    expect(a).not.toBe(b);
  });
  it("incorporates SSN last-4 when present", () => {
    const withSsn = usIdentityDedupeKey({ first_names: "Jane", surname: "Doe", date_of_birth: "1990-03-15", ssn_last4: "1234" });
    const without = usIdentityDedupeKey({ first_names: "Jane", surname: "Doe", date_of_birth: "1990-03-15" });
    expect(withSsn).not.toBe(without);
    expect(usIdentityDedupeKey({ first_names: "Jane", surname: "Doe", date_of_birth: "1990-03-15", ssn_last4: null })).toBe(without);
  });
});
