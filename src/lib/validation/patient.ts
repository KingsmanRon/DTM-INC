// Zod schemas mirroring the onboarding form (§FR-3). Shared between the
// onboarding wizard (client) and the API route (server).
import { z } from "zod";
import { isValidSaId } from "./sa-id";

export const TitleEnum = z.enum(["Mr", "Mrs", "Miss", "Dr", "Prof", "Other"]);
export const MaritalStatus = z.enum(["single", "married", "divorced", "widowed", "partnered"]);
export const PayerType = z.enum(["medical_aid", "private"]);
export const IdType = z.enum(["sa_id", "passport", "other"]);
export const Sex = z.enum(["m", "f", "other"]);
export const ReferrerType = z.enum(["gp", "specialist", "hospital", "self", "other"]);

const e164 = z.string().regex(/^\+?[0-9 ()-]{7,20}$/, "Invalid phone number");
const emailOptional = z.string().email().optional().or(z.literal(""));

export const IdNumberSchema = z.object({
  id_type: IdType,
  id_number: z.string().min(3),
  id_country: z.string().length(2).optional(),
}).refine((v) => v.id_type !== "sa_id" || isValidSaId(v.id_number), {
  message: "Invalid SA ID number (checksum failed)",
  path: ["id_number"],
}).refine((v) => v.id_type !== "passport" || !!v.id_country, {
  message: "Passport requires a country code",
  path: ["id_country"],
});

// Section A — Patient details
export const HospitalEnum = z.enum(["Nkanyezi Private Hospital", "Fountain Private Hospital", "Mediclinic Vereeniging Hospital", "Midvaal Private Hospital"]);

export const SectionA = z.object({
  hospital: HospitalEnum,
  title: TitleEnum,
  first_names: z.string().min(1),
  surname: z.string().min(1),
  id_type: IdType,
  id_number: z.string().min(3),
  id_country: z.string().length(2).optional(),
  email: emailOptional,
  phone: e164,
  address: z.string().min(1),
}).refine((v) => v.id_type !== "sa_id" || isValidSaId(v.id_number), {
  message: "Invalid SA ID number",
  path: ["id_number"],
});

// Section B — Person responsible for account
export const SectionB = z.object({
  same_as_patient: z.boolean(),
  title: TitleEnum,
  first_names: z.string().min(1),
  surname: z.string().min(1),
  id_number: z.string().min(3),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  marital_status: MaritalStatus,
  email: emailOptional,
  phone: e164,
  home_address: z.string().min(1),
  spouse_partner_phone: z.string().optional().or(z.literal("")),
  spouse_partner_work_phone: z.string().optional().or(z.literal("")),
  employer_name: z.string().optional().or(z.literal("")),
  occupation: z.string().optional().or(z.literal("")),
  work_address: z.string().optional().or(z.literal("")),
  work_phone: z.string().optional().or(z.literal("")),
});

// Section C — Medical aid
export const SectionC = z.object({
  same_as_responsible: z.boolean(),
  main_member_name: z.string().optional().or(z.literal("")),
  medical_aid_name: z.string().optional().or(z.literal("")),  // free text, §15
  membership_number: z.string().optional().or(z.literal("")),
  plan: z.string().optional().or(z.literal("")),
  other_plan_detail: z.string().optional().or(z.literal("")),
  is_private_payer: z.boolean().default(false),
}).refine(
  (v) => v.is_private_payer || (!!v.medical_aid_name && !!v.membership_number && !!v.plan),
  { message: "Medical aid name, number, and plan are required unless private payer", path: ["medical_aid_name"] }
);

// Section D — Nearest family / friend
export const SectionD = z.object({
  name: z.string().min(1),
  relationship: z.string().min(1),
  address: z.string().optional().or(z.literal("")),
  email: emailOptional,
  phone: e164,
});

// Section E — Referred by
export const SectionE = z.object({
  referrer_type: ReferrerType,
  referrer_name: z.string().optional().or(z.literal("")),
  referrer_phone: z.string().optional().or(z.literal("")),
  referral_notes: z.string().optional().or(z.literal("")),
}).refine((v) => v.referrer_type === "self" || !!v.referrer_name, {
  message: "Referrer name required", path: ["referrer_name"],
}).refine((v) => v.referrer_type === "self" || !!v.referrer_phone, {
  message: "Referrer phone required", path: ["referrer_phone"],
});

// Section F — Dependants
export const DependantSchema = z.object({
  name: z.string().min(1),
  sex: Sex,
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dependant_code: z.string().min(1),
  allergies: z.string().optional().or(z.literal("")),
});

// Section G — Consent
export const ConsentCapture = z.object({
  consent_text_version: z.string().min(1),
  consent_text_hash: z.string().regex(/^[a-f0-9]{64}$/, "Must be sha256 hex"),
  consent_summary_version: z.string().min(1),
  signature_type: z.enum(["typed_name", "drawn_signature"]),
  signature_value: z.string().min(1),
  patient_present_attestation: z.literal(true, {
    errorMap: () => ({ message: "Staff must attest patient was present" }),
  }),
});

// Full onboarding payload
export const OnboardingPayload = z.object({
  section_a: SectionA,
  section_b: SectionB,
  section_c: SectionC,
  section_d: SectionD,
  section_e: SectionE,
  dependants: z.array(DependantSchema).default([]),
  consent: ConsentCapture,
});

export type OnboardingPayload = z.infer<typeof OnboardingPayload>;
