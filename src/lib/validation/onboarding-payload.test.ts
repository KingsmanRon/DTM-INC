// Regression tests: the onboarding wizard's typical payloads MUST pass the
// shared OnboardingPayload schema (written during the 2026-06-11 submit
// incident to rule client-side validation in/out — kept because a schema
// change that breaks a normal front-desk fill should fail CI, not reception).
import { describe, expect, it } from "vitest";
import { OnboardingPayload } from "./patient";

const typicalAdultPayload = {
  section_a: {
    hospital: "Nkanyezi Private Hospital",
    is_minor: false,
    title: "Mr",
    first_names: "Test",
    surname: "Patient",
    id_type: "sa_id",
    id_number: "8001015009087", // Luhn-valid SA ID
    email: "",
    phone: "+27821234567",
    address: "1 Test Street, Sebokeng",
  },
  section_b: {
    same_as_patient: true,
    title: "Mr",
    first_names: "Test",
    surname: "Patient",
    id_number: "8001015009087",
    date_of_birth: "1980-01-01",
    marital_status: "single",
    email: "",
    phone: "+27821234567",
    home_address: "1 Test Street, Sebokeng",
    spouse_partner_phone: "",
    spouse_partner_work_phone: "",
    employer_name: "",
    occupation: "",
    work_address: "",
    work_phone: "",
  },
  section_c: {
    same_as_responsible: false,
    main_member_name: "",
    medical_aid_name: "",
    membership_number: "",
    plan: "",
    other_plan_detail: "",
    is_private_payer: true,
  },
  section_d: { name: "Spouse Person", relationship: "Spouse", address: "", email: "", phone: "+27821234568" },
  section_e: { referrer_type: "self", referrer_name: "", referrer_phone: "", referral_notes: "" },
  dependants: [],
  consent: {
    consent_text_version: "1.0.0",
    consent_text_hash: "a".repeat(64),
    consent_summary_version: "cards-v1",
    signature_type: "typed_name",
    signature_value: "Test Patient",
    patient_present_attestation: true,
  },
};

describe("incident repro: wizard payload vs OnboardingPayload", () => {
  it("typical adult private-payer payload passes", () => {
    const r = OnboardingPayload.safeParse(typicalAdultPayload);
    if (!r.success) console.error(JSON.stringify(r.error.issues, null, 2));
    expect(r.success).toBe(true);
  });

  it("typical adult MEDICAL-AID payload passes", () => {
    const r = OnboardingPayload.safeParse({
      ...typicalAdultPayload,
      section_c: {
        same_as_responsible: true,
        main_member_name: "Test Patient",
        medical_aid_name: "Discovery",
        membership_number: "123456789",
        plan: "Classic",
        other_plan_detail: "",
        is_private_payer: false,
      },
    });
    if (!r.success) console.error(JSON.stringify(r.error.issues, null, 2));
    expect(r.success).toBe(true);
  });

  it("emergency-contact phone left as the +27 prefill is the trap that bounces to step D", () => {
    const r = OnboardingPayload.safeParse({
      ...typicalAdultPayload,
      section_d: { ...typicalAdultPayload.section_d, phone: "+27" },
    });
    expect(r.success).toBe(false);
  });
});
