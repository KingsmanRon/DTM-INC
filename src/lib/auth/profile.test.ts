import { describe, it, expect } from "vitest";
import { apiMfaSatisfied } from "./profile";

// API-layer MFA policy (FR-1). This is the gate enforced inside requireRole so
// a direct API caller cannot bypass the TOTP step the page layout forces.
describe("apiMfaSatisfied", () => {
  it("requires aal2 for doctor", () => {
    expect(apiMfaSatisfied("doctor", "aal2")).toBe(true);
    expect(apiMfaSatisfied("doctor", "aal1")).toBe(false);
    expect(apiMfaSatisfied("doctor", null)).toBe(false);
    expect(apiMfaSatisfied("doctor", undefined)).toBe(false);
  });

  it("requires aal2 for admin", () => {
    expect(apiMfaSatisfied("admin", "aal2")).toBe(true);
    expect(apiMfaSatisfied("admin", "aal1")).toBe(false);
    expect(apiMfaSatisfied("admin", null)).toBe(false);
  });

  it("requires aal2 for staff", () => {
    expect(apiMfaSatisfied("staff", "aal1")).toBe(false);
    expect(apiMfaSatisfied("staff", "aal2")).toBe(true);
    expect(apiMfaSatisfied("staff", null)).toBe(false);
    expect(apiMfaSatisfied("staff", undefined)).toBe(false);
  });
});
