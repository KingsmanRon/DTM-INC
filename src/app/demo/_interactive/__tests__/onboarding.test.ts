import { describe, expect, it } from "vitest";
import {
  STEP_COUNT,
  applySampleToStep,
  emptyDependant,
  emptyDraft,
  findDuplicateByIdentity,
  normaliseIdentifier,
  sampleDraft,
  validateAll,
  validateDependant,
  validateIdentifier,
  validateStep,
} from "@/app/demo/_interactive/state/onboarding";
import { SEED_PATIENTS } from "@/app/demo/_interactive/fixtures/patients";

describe("onboarding validation", () => {
  it("has seven steps", () => {
    expect(STEP_COUNT).toBe(7);
  });

  it("reports validation messages on an empty first step", () => {
    const errors = validateStep(0, emptyDraft());
    expect(Object.keys(errors)).toEqual(
      expect.arrayContaining([
        "patient.facilityId",
        "patient.title",
        "patient.firstNames",
        "patient.surname",
        "patient.idNumber",
        "patient.dateOfBirth",
        "patient.phone",
        "patient.address",
      ]),
    );
    expect(errors["patient.surname"]).toMatch(/surname/i);
  });

  it("accepts the controlled sample data on every step", () => {
    const draft = sampleDraft();
    expect(validateAll(draft)).toMatchObject({ valid: true, firstInvalidStep: null });
    for (let step = 0; step < STEP_COUNT; step += 1) expect(validateStep(step, draft)).toEqual({});
  });

  it("fills one step at a time from sample data", () => {
    let draft = emptyDraft();
    // Responsible party defaults to "same as patient" and dependants are optional,
    // so those two steps are valid even when empty.
    const optionalWhenEmpty = new Set([1, 5]);
    for (let step = 0; step < STEP_COUNT; step += 1) {
      const emptyErrors = Object.keys(validateStep(step, draft)).length;
      if (optionalWhenEmpty.has(step)) expect(emptyErrors).toBe(0);
      else expect(emptyErrors).toBeGreaterThan(0);
      draft = applySampleToStep(draft, step);
      expect(validateStep(step, draft)).toEqual({});
    }
    expect(validateAll(draft).valid).toBe(true);
  });

  it("requires a medical aid scheme, number and plan unless private payer", () => {
    const draft = { ...sampleDraft(), payer: { kind: "medical_aid" as const, scheme: "", membershipNumber: "", plan: "" } };
    expect(Object.keys(validateStep(2, draft))).toEqual(["payer.scheme", "payer.membershipNumber", "payer.plan"]);
    expect(validateStep(2, { ...draft, payer: { kind: "private", scheme: "", membershipNumber: "", plan: "" } })).toEqual({});
    expect(validateStep(2, { ...draft, payer: { ...draft.payer, kind: "" } })["payer.kind"]).toBeDefined();
  });

  it("requires referrer details unless self-referred", () => {
    const draft = sampleDraft();
    expect(validateStep(4, { ...draft, referral: { source: "gp", name: "", phone: "", notes: "" } })).toHaveProperty("referral.name");
    expect(validateStep(4, { ...draft, referral: { source: "self", name: "", phone: "", notes: "" } })).toEqual({});
  });

  it("asks for responsible-party details only when not the patient", () => {
    const draft = sampleDraft();
    expect(validateStep(1, draft)).toEqual({});
    const other = { ...draft, responsible: { ...draft.responsible, sameAsPatient: false } };
    expect(Object.keys(validateStep(1, other))).toEqual(
      expect.arrayContaining(["responsible.name", "responsible.relationship", "responsible.idNumber", "responsible.phone", "responsible.address"]),
    );
  });

  it("blocks leaving the dependants step with a half-filled dependant", () => {
    const draft = { ...sampleDraft(), dependantInput: { name: "Half", dateOfBirth: "", code: "" } };
    expect(validateStep(5, draft)).toHaveProperty("dependantInput.name");
    expect(validateDependant(emptyDependant())).toHaveProperty("dependantInput.name");
    expect(validateDependant({ name: "Child", dateOfBirth: "2016-09-03", code: "01" })).toEqual({});
  });

  it("requires consent and a typed signature", () => {
    const draft = { ...sampleDraft(), consent: { agreed: false, signedName: "" } };
    expect(Object.keys(validateStep(6, draft))).toEqual(["consent.agreed", "consent.signedName"]);
  });

  it("rejects impossible and future dates of birth", () => {
    const draft = sampleDraft();
    expect(validateStep(0, { ...draft, patient: { ...draft.patient, dateOfBirth: "2030-01-01" } })).toHaveProperty("patient.dateOfBirth");
    expect(validateStep(0, { ...draft, patient: { ...draft.patient, dateOfBirth: "2020-02-31" } })).toHaveProperty("patient.dateOfBirth");
  });
});

describe("synthetic identifiers only", () => {
  it("rejects anything that resembles a genuine 13-digit national ID number", () => {
    expect(validateIdentifier("id", "9001015800085")).not.toBeNull();
    expect(validateIdentifier("id", "900101 5800 085")).not.toBeNull();
    expect(validateIdentifier("passport", "A1234567")).not.toBeNull();
  });

  it("accepts the synthetic format and matches it to the identity type", () => {
    expect(validateIdentifier("id", "SYN-ID-20001")).toBeNull();
    expect(validateIdentifier("id", "syn-id-20001")).toBeNull();
    expect(validateIdentifier("passport", "SYN-PP-30002")).toBeNull();
    expect(validateIdentifier("id", "SYN-PP-30002")).not.toBeNull();
    expect(validateIdentifier("passport", "SYN-ID-20001")).not.toBeNull();
  });

  it("uses synthetic identifiers throughout the seeded register", () => {
    for (const p of SEED_PATIENTS) expect(p.idNumber).toMatch(/^SYN-(ID|PP)-\d{5}$/);
    expect(new Set(SEED_PATIENTS.map((p) => normaliseIdentifier(p.idNumber))).size).toBe(SEED_PATIENTS.length);
  });
});

describe("duplicate detection", () => {
  it("matches an existing identity ignoring case, spacing and punctuation", () => {
    expect(findDuplicateByIdentity(SEED_PATIENTS, "id", "SYN-ID-10004")?.id).toBe("p-0004");
    expect(findDuplicateByIdentity(SEED_PATIENTS, "id", " syn id 10004 ")?.id).toBe("p-0004");
    expect(findDuplicateByIdentity(SEED_PATIENTS, "passport", "SYN-PP-30001")?.id).toBe("p-0009");
  });

  it("does not report a duplicate for a new identifier or the wrong identity type", () => {
    expect(findDuplicateByIdentity(SEED_PATIENTS, "id", "SYN-ID-20001")).toBeUndefined();
    expect(findDuplicateByIdentity(SEED_PATIENTS, "passport", "SYN-ID-10004")).toBeUndefined();
    expect(findDuplicateByIdentity(SEED_PATIENTS, "id", "")).toBeUndefined();
  });

  it("also treats archived records as existing files", () => {
    expect(findDuplicateByIdentity(SEED_PATIENTS, "id", "SYN-ID-10008")?.recordStatus).toBe("archived");
  });
});
