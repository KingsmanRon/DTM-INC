// Regression tests: the onboarding wizard's typical payloads MUST pass the
// shared OnboardingPayload schema (written during the 2026-06-11 submit
// incident to rule client-side validation in/out — kept because a schema
// change that breaks a normal front-desk fill should fail CI, not reception).
import { describe, expect, it } from "vitest";
import { OnboardingPayload } from "./patient";
import { OnboardingPayloadUs, onboardingPayloadForLocale } from "./onboarding-us";

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

const typicalUsAdultPayload = {
  section_a: {
    hospital: "Downtown Clinic",
    is_minor: false,
    title: "Mr",
    first_names: "John",
    surname: "Liberty",
    id_type: "none",
    date_of_birth: "1985-07-21",
    ssn_last4: "1234",
    email: "",
    phone: "+12025550147",
    address: "100 Main St, Austin TX",
  },
  section_b: {
    same_as_patient: true,
    title: "Mr",
    first_names: "John",
    surname: "Liberty",
    email: "",
    phone: "+12025550147",
    home_address: "100 Main St, Austin TX",
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
  section_d: { name: "Jane Liberty", relationship: "Spouse", address: "", email: "", phone: "+12025550148" },
  section_e: { referrer_type: "self", referrer_name: "", referrer_phone: "", referral_notes: "" },
  dependants: [],
  consent: {
    consent_text_version: "1.0.0",
    consent_text_hash: "a".repeat(64),
    consent_summary_version: "cards-v1",
    signature_type: "typed_name",
    signature_value: "John Liberty",
    patient_present_attestation: true,
  },
};

describe("US onboarding schema (locale 'us')", () => {
  it("typical US adult payload (name + DOB, no national ID) passes", () => {
    const r = OnboardingPayloadUs.safeParse(typicalUsAdultPayload);
    if (!r.success) console.error(JSON.stringify(r.error.issues, null, 2));
    expect(r.success).toBe(true);
  });

  it("rejects a US payload missing date_of_birth (the identity anchor)", () => {
    const { date_of_birth, ...sectionANoDob } = typicalUsAdultPayload.section_a;
    void date_of_birth;
    const r = OnboardingPayloadUs.safeParse({ ...typicalUsAdultPayload, section_a: sectionANoDob });
    expect(r.success).toBe(false);
  });

  it("rejects an SSN last-4 that is not 4 digits", () => {
    const r = OnboardingPayloadUs.safeParse({
      ...typicalUsAdultPayload,
      section_a: { ...typicalUsAdultPayload.section_a, ssn_last4: "12" },
    });
    expect(r.success).toBe(false);
  });

  it("onboardingPayloadForLocale routes by locale: us accepts, za (SA) rejects the US shape", () => {
    expect(onboardingPayloadForLocale("us").safeParse(typicalUsAdultPayload).success).toBe(true);
    // The SA schema requires sa_id/passport + id_number, so a US-shaped payload fails it.
    expect(onboardingPayloadForLocale("za").safeParse(typicalUsAdultPayload).success).toBe(false);
  });

  it("US insured payload (carrier + subscriber ID + group + relationship) passes", () => {
    const r = OnboardingPayloadUs.safeParse({
      ...typicalUsAdultPayload,
      section_c: {
        same_as_responsible: true,
        main_member_name: "John Liberty",
        medical_aid_name: "Aetna",
        membership_number: "W123456789",
        plan: "PPO",
        other_plan_detail: "",
        is_private_payer: false,
        group_number: "GRP0001",
        subscriber_relationship: "self",
      },
    });
    if (!r.success) console.error(JSON.stringify(r.error.issues, null, 2));
    expect(r.success).toBe(true);
  });

  it("US insured payload missing carrier/subscriber ID fails (not self-pay)", () => {
    const r = OnboardingPayloadUs.safeParse({
      ...typicalUsAdultPayload,
      section_c: { ...typicalUsAdultPayload.section_c, is_private_payer: false },
    });
    expect(r.success).toBe(false);
  });
});
