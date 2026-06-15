// US (locale "us") onboarding schemas. Kept SEPARATE from patient.ts so the SA
// path stays byte-identical and at zero regression risk — patient.ts is the
// 'za' schema, this is the 'us' one, and onboardingPayloadForLocale() picks.
//
// US identity differs structurally from SA: no national ID (id_type is always
// 'none'), date_of_birth is the required anchor, SSN last-4 optional. The
// responsible party (section B) has no national ID either and an adult is often
// their own guarantor, so its identity fields are relaxed. Sections C/D/E and
// consent are reused unchanged for this slice — the insurance re-model (payer
// section) is a later, separate slice.
import { z } from "zod";
import type { PracticeLocale } from "@/lib/practice/locale";
import { usDateOfBirth, usSsnLast4 } from "./us-identity";
import {
  TitleEnum,
  MaritalStatus,
  SectionC,
  SectionD,
  SectionE,
  DependantSchema,
  ConsentCapture,
  OnboardingPayload,
} from "./patient";

// Re-declared locally (module-private in patient.ts) to avoid widening that
// file's API just for the US schema.
const e164 = z
  .string()
  .regex(/^\+?[0-9 ()-]{7,20}$/, "Please enter a valid phone number (7–20 digits).");
const emailOptional = z
  .string()
  .email("Please enter a valid email address.")
  .optional()
  .or(z.literal(""));

// Section A — US patient details. id_type is fixed to 'none' (no national ID);
// identity is name + date_of_birth, SSN last-4 optional.
export const UsSectionA = z.object({
  hospital: z.string().min(1, "Please select a clinic/facility."),
  is_minor: z.boolean().default(false),
  title: TitleEnum,
  first_names: z.string().min(1, "Patient first name is required."),
  surname: z.string().min(1, "Patient last name is required."),
  id_type: z.literal("none").default("none"),
  date_of_birth: usDateOfBirth,
  ssn_last4: usSsnLast4.optional().or(z.literal("")),
  email: emailOptional,
  phone: e164,
  address: z.string().min(1, "Patient address is required."),
});

// Section B — person responsible for the account (guarantor). No national ID;
// DOB and marital status optional (SA-only requirements). Name, phone, and
// address remain required — they map to the still-NOT-NULL columns on
// patient_account_responsible after migration 0058.
export const UsSectionB = z.object({
  same_as_patient: z.boolean().default(false),
  title: TitleEnum,
  first_names: z.string().min(1, "Responsible party first name is required."),
  surname: z.string().min(1, "Responsible party last name is required."),
  date_of_birth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be in YYYY-MM-DD format.")
    .optional()
    .or(z.literal("")),
  marital_status: MaritalStatus.optional(),
  email: emailOptional,
  phone: e164,
  home_address: z.string().min(1, "Responsible party address is required."),
  spouse_partner_phone: z.string().optional().or(z.literal("")),
  spouse_partner_work_phone: z.string().optional().or(z.literal("")),
  employer_name: z.string().optional().or(z.literal("")),
  occupation: z.string().optional().or(z.literal("")),
  work_address: z.string().optional().or(z.literal("")),
  work_phone: z.string().optional().or(z.literal("")),
});

// Full US onboarding payload. Sections C/D/E + consent reused from the SA schema.
export const OnboardingPayloadUs = z.object({
  section_a: UsSectionA,
  section_b: UsSectionB,
  section_c: SectionC,
  section_d: SectionD,
  section_e: SectionE,
  dependants: z.array(DependantSchema).default([]),
  consent: ConsentCapture,
});

export type OnboardingPayloadUs = z.infer<typeof OnboardingPayloadUs>;

// Pick the onboarding schema for a practice's locale. Default ('za') returns the
// untouched SA schema, so existing deployments are unaffected. Typed ZodTypeAny
// because the two branches are different Zod shapes (the route casts the parsed
// result to the locale-appropriate type).
export function onboardingPayloadForLocale(locale: PracticeLocale): z.ZodTypeAny {
  return locale === "us" ? OnboardingPayloadUs : OnboardingPayload;
}
