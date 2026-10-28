import type { Dependant, OnboardingDraft, Patient } from "@/app/demo/_interactive/types";
import { DEMO_TODAY } from "./clock";

/**
 * Onboarding wizard model: draft shape, per-step validation and the
 * controlled fictional "sample data" used by the guided "Use sample data"
 * action. Validation also enforces the synthetic identifier format, which
 * stops genuine national ID numbers being typed into the demonstration.
 */

export const STEP_LABELS = [
  "Patient details",
  "Responsible party",
  "Medical aid or private payer",
  "Emergency contact",
  "Referral information",
  "Dependants",
  "Consent and final review",
] as const;

export const STEP_COUNT = STEP_LABELS.length;

export type FieldErrors = Record<string, string>;

export const SYNTHETIC_ID_PATTERN = /^SYN-(ID|PP)-\d{5}$/i;
export const SYNTHETIC_ID_HELP = "Use a synthetic identifier such as SYN-ID-20001. Real ID numbers are not accepted.";

const PHONE_PATTERN = /^[0-9 ()+-]{7,20}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function emptyDependant(): Dependant {
  return { name: "", dateOfBirth: "", code: "" };
}

export function emptyDraft(): OnboardingDraft {
  return {
    patient: {
      facilityId: "",
      title: "",
      firstNames: "",
      surname: "",
      idType: "id",
      idNumber: "",
      dateOfBirth: "",
      phone: "",
      email: "",
      address: "",
    },
    responsible: { sameAsPatient: true, name: "", relationship: "", idNumber: "", phone: "", address: "" },
    payer: { kind: "", scheme: "", membershipNumber: "", plan: "" },
    emergency: { name: "", relationship: "", phone: "", email: "" },
    referral: { source: "", name: "", phone: "", notes: "" },
    dependants: [],
    dependantInput: emptyDependant(),
    consent: { agreed: false, signedName: "" },
  };
}

/** Uppercases and strips punctuation so "syn-id 10002" matches "SYN-ID-10002". */
export function normaliseIdentifier(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isRealDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function validateDate(value: string, label: string): string | null {
  if (!value) return `${label} is required.`;
  if (!isRealDate(value)) return `Enter ${label.toLowerCase()} as a valid date.`;
  if (value > DEMO_TODAY) return `${label} cannot be in the future.`;
  if (value < "1900-01-01") return `${label} is not plausible.`;
  return null;
}

export function validateIdentifier(idType: "id" | "passport", value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Enter an identifier.";
  if (!SYNTHETIC_ID_PATTERN.test(trimmed)) return SYNTHETIC_ID_HELP;
  const kind = /^SYN-PP/i.test(trimmed) ? "passport" : "id";
  if (kind !== idType) {
    return idType === "id"
      ? "Identity type is ID number, so use SYN-ID-##### (SYN-PP-##### is for passports)."
      : "Identity type is passport, so use SYN-PP-##### (SYN-ID-##### is for ID numbers).";
  }
  return null;
}

function required(errors: FieldErrors, key: string, value: string, message: string): void {
  if (!value.trim()) errors[key] = message;
}

export function validateDependant(dependant: Dependant): FieldErrors {
  const errors: FieldErrors = {};
  required(errors, "dependantInput.name", dependant.name, "Enter the dependant's name.");
  const dateError = validateDate(dependant.dateOfBirth, "Dependant date of birth");
  if (dateError) errors["dependantInput.dateOfBirth"] = dateError;
  required(errors, "dependantInput.code", dependant.code, "Enter a dependant code (for example 01).");
  return errors;
}

export function validateStep(step: number, draft: OnboardingDraft): FieldErrors {
  const errors: FieldErrors = {};
  switch (step) {
    case 0: {
      const p = draft.patient;
      required(errors, "patient.facilityId", p.facilityId, "Choose a hospital.");
      required(errors, "patient.title", p.title, "Choose a title.");
      required(errors, "patient.firstNames", p.firstNames, "Enter the patient's first names.");
      required(errors, "patient.surname", p.surname, "Enter the patient's surname.");
      const idError = validateIdentifier(p.idType, p.idNumber);
      if (idError) errors["patient.idNumber"] = idError;
      const dobError = validateDate(p.dateOfBirth, "Date of birth");
      if (dobError) errors["patient.dateOfBirth"] = dobError;
      if (!p.phone.trim()) errors["patient.phone"] = "Enter a phone number.";
      else if (!PHONE_PATTERN.test(p.phone.trim())) errors["patient.phone"] = "Enter a valid phone number (7 to 20 digits).";
      if (p.email.trim() && !EMAIL_PATTERN.test(p.email.trim())) errors["patient.email"] = "Enter a valid email address, or leave it blank.";
      required(errors, "patient.address", p.address, "Enter the patient's address.");
      break;
    }
    case 1: {
      const r = draft.responsible;
      if (r.sameAsPatient) break;
      required(errors, "responsible.name", r.name, "Enter the responsible person's name.");
      required(errors, "responsible.relationship", r.relationship, "Enter the relationship to the patient.");
      const idError = validateIdentifier("id", r.idNumber);
      if (idError) errors["responsible.idNumber"] = idError;
      if (!r.phone.trim()) errors["responsible.phone"] = "Enter a phone number.";
      else if (!PHONE_PATTERN.test(r.phone.trim())) errors["responsible.phone"] = "Enter a valid phone number (7 to 20 digits).";
      required(errors, "responsible.address", r.address, "Enter the responsible person's address.");
      break;
    }
    case 2: {
      const p = draft.payer;
      if (!p.kind) {
        errors["payer.kind"] = "Choose medical aid or private payer.";
        break;
      }
      if (p.kind === "medical_aid") {
        required(errors, "payer.scheme", p.scheme, "Choose a medical aid scheme.");
        required(errors, "payer.membershipNumber", p.membershipNumber, "Enter the membership number.");
        required(errors, "payer.plan", p.plan, "Enter the plan or option.");
      }
      break;
    }
    case 3: {
      const e = draft.emergency;
      required(errors, "emergency.name", e.name, "Enter the emergency contact's name.");
      required(errors, "emergency.relationship", e.relationship, "Enter the relationship to the patient.");
      if (!e.phone.trim()) errors["emergency.phone"] = "Enter a phone number.";
      else if (!PHONE_PATTERN.test(e.phone.trim())) errors["emergency.phone"] = "Enter a valid phone number (7 to 20 digits).";
      if (e.email.trim() && !EMAIL_PATTERN.test(e.email.trim())) errors["emergency.email"] = "Enter a valid email address, or leave it blank.";
      break;
    }
    case 4: {
      const r = draft.referral;
      if (!r.source) {
        errors["referral.source"] = "Choose how the patient was referred.";
        break;
      }
      if (r.source !== "self") {
        required(errors, "referral.name", r.name, "Enter the referrer's name.");
        required(errors, "referral.phone", r.phone, "Enter the referrer's phone number.");
      }
      break;
    }
    case 5: {
      const input = draft.dependantInput;
      if (input.name.trim() || input.dateOfBirth.trim() || input.code.trim()) {
        errors["dependantInput.name"] = "Add this dependant to the list, or clear the fields, before continuing.";
      }
      break;
    }
    case 6: {
      if (!draft.consent.agreed) errors["consent.agreed"] = "Consent must be confirmed to complete registration.";
      required(errors, "consent.signedName", draft.consent.signedName, "Type the patient's name as their signature.");
      break;
    }
    default:
      break;
  }
  return errors;
}

export interface DraftValidation {
  valid: boolean;
  firstInvalidStep: number | null;
  errors: FieldErrors[];
}

export function validateAll(draft: OnboardingDraft): DraftValidation {
  const errors = Array.from({ length: STEP_COUNT }, (_, step) => validateStep(step, draft));
  const firstInvalid = errors.findIndex((e) => Object.keys(e).length > 0);
  return { valid: firstInvalid === -1, firstInvalidStep: firstInvalid === -1 ? null : firstInvalid, errors };
}

/** Exact, normalised identifier match within the one practice register. */
export function findDuplicateByIdentity(
  patients: readonly Patient[],
  idType: "id" | "passport",
  idNumber: string,
): Patient | undefined {
  const wanted = normaliseIdentifier(idNumber);
  if (!wanted) return undefined;
  return patients.find((p) => p.idType === idType && normaliseIdentifier(p.idNumber) === wanted);
}

export interface ContactChanges {
  phone?: string;
  email?: string;
  address?: string;
  membershipNumber?: string;
}

/** Validation for the "amend patient details" form (only supplied fields are checked). */
export function validateContactChanges(changes: ContactChanges): FieldErrors {
  const errors: FieldErrors = {};
  if (changes.phone !== undefined) {
    if (!changes.phone.trim()) errors.phone = "Enter a phone number.";
    else if (!PHONE_PATTERN.test(changes.phone.trim())) errors.phone = "Enter a valid phone number (7 to 20 digits).";
  }
  if (changes.email !== undefined && changes.email.trim() && !EMAIL_PATTERN.test(changes.email.trim())) {
    errors.email = "Enter a valid email address, or leave it blank.";
  }
  if (changes.address !== undefined && !changes.address.trim()) errors.address = "Enter an address.";
  if (changes.membershipNumber !== undefined && !changes.membershipNumber.trim()) {
    errors.membershipNumber = "Enter the membership number.";
  }
  return errors;
}

/** Controlled fictional values for the "Use sample data" action. */
export const SAMPLE_PATIENT_IDENTIFIER = "SYN-ID-20001";

export function sampleDraft(): OnboardingDraft {
  return {
    patient: {
      facilityId: "nth",
      title: "Ms",
      firstNames: "Zodwa",
      surname: "Maseko",
      idType: "id",
      idNumber: SAMPLE_PATIENT_IDENTIFIER,
      dateOfBirth: "1988-04-17",
      phone: "000 000 0140",
      email: "zodwa.maseko@example.test",
      address: "Unit 4, 12 Sample Street, Demoville, 0000",
    },
    responsible: { sameAsPatient: true, name: "", relationship: "", idNumber: "", phone: "", address: "" },
    payer: { kind: "medical_aid", scheme: "Demo Health Scheme", membershipNumber: "DHS-55021-Z", plan: "Essential Plan" },
    emergency: { name: "Sipho Maseko", relationship: "Spouse", phone: "000 000 0141", email: "" },
    referral: { source: "gp", name: "Dr Example GP", phone: "000 000 0900", notes: "Referred for a first consultation." },
    dependants: [{ name: "Lwazi Maseko", dateOfBirth: "2016-09-03", code: "01" }],
    dependantInput: emptyDependant(),
    consent: { agreed: true, signedName: "Zodwa Maseko" },
  };
}

/** Fills only the given step of `draft` with sample values. */
export function applySampleToStep(draft: OnboardingDraft, step: number): OnboardingDraft {
  const sample = sampleDraft();
  switch (step) {
    case 0:
      return { ...draft, patient: sample.patient };
    case 1:
      return { ...draft, responsible: sample.responsible };
    case 2:
      return { ...draft, payer: sample.payer };
    case 3:
      return { ...draft, emergency: sample.emergency };
    case 4:
      return { ...draft, referral: sample.referral };
    case 5:
      return { ...draft, dependants: sample.dependants, dependantInput: emptyDependant() };
    case 6:
      return { ...draft, consent: sample.consent };
    default:
      return draft;
  }
}
