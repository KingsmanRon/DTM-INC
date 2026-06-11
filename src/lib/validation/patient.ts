// Zod schemas mirroring the onboarding form (§FR-3). Shared between the
// onboarding wizard (client) and the API route (server).
import { z } from "zod";
import { isValidSaId } from "./sa-id";

export const TitleEnum = z.enum(["Mr", "Mrs", "Miss", "Dr", "Prof", "Other"], {
  errorMap: () => ({ message: "Please select a valid title." }),
});
export const MaritalStatus = z.enum(["single", "married", "divorced", "widowed", "partnered"], {
  errorMap: () => ({ message: "Please select a valid marital status." }),
});
export const PayerType = z.enum(["medical_aid", "private"], {
  errorMap: () => ({ message: "Please select a valid payer type." }),
});
export const IdType = z.enum(["sa_id", "passport", "none_minor"], {
  errorMap: () => ({ message: "Please select a valid ID type." }),
});
export const Sex = z.enum(["m", "f", "other"], {
  errorMap: () => ({ message: "Please select a valid sex value." }),
});
export const ReferrerType = z.enum(["gp", "specialist", "hospital", "self", "other"], {
  errorMap: () => ({ message: "Please select a valid referrer type." }),
});

const e164 = z
  .string()
  .regex(/^\+?[0-9 ()-]{7,20}$/, "Please enter a valid phone number (7–20 digits).");
const emailOptional = z
  .string()
  .email("Please enter a valid email address.")
  .optional()
  .or(z.literal(""));

export const IdNumberSchema = z
  .object({
    id_type: IdType,
    id_number: z.string().min(3, "ID number must be at least 3 characters."),
    id_country: z.string().length(2, "Passport country must be a 2-letter code.").optional(),
  })
  .refine((v) => v.id_type !== "sa_id" || isValidSaId(v.id_number), {
    message: "Invalid SA ID number (checksum failed)",
    path: ["id_number"],
  })
  .refine((v) => v.id_type !== "passport" || !!v.id_country, {
    message: "Passport requires a country code",
    path: ["id_country"],
  });

// Section A — Patient details
//
// Hospital is a plain string at the schema layer: the allowed values live in
// public.hospitals (migration 0044), so the list changes per practice without
// a code change. The API route checks the value against the table (422), and
// onboard_patient() hard-fails on unknown/inactive as the backstop.
export const SectionA = z
  .object({
    hospital: z.string().min(1, "Please select a hospital."),
    is_minor: z.boolean().default(false),
    title: TitleEnum,
    first_names: z.string().min(1, "Patient first names are required."),
    surname: z.string().min(1, "Patient surname is required."),
    id_type: IdType,
    id_number: z.string().min(3, "Patient ID number must be at least 3 characters."),
    id_country: z.string().length(2, "Passport country must be a 2-letter code.").optional(),
    email: emailOptional,
    phone: e164,
    address: z.string().min(1, "Patient physical address is required."),
  })
  .superRefine((v, ctx) => {
    if (!v.is_minor) {
      if (v.id_type === "none_minor") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Adults must use SA ID or passport",
          path: ["id_type"],
        });
      }
      if (v.id_type === "sa_id" && !isValidSaId(v.id_number)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid SA ID number",
          path: ["id_number"],
        });
      }
      if (v.id_type === "passport" && !v.id_country) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passport requires a country code",
          path: ["id_country"],
        });
      }
      return;
    }

    // Minor: may use none_minor, or standard SA ID / passport with normal validation.
    if (v.id_type === "sa_id" && !isValidSaId(v.id_number)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid SA ID number",
        path: ["id_number"],
      });
    }
    if (v.id_type === "passport" && !v.id_country) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Passport requires a country code",
        path: ["id_country"],
      });
    }
  });

// Section B — Person responsible for account
export const SectionB = z.object({
  same_as_patient: z.boolean(),
  title: TitleEnum,
  first_names: z.string().min(1, "Responsible person first names are required."),
  surname: z.string().min(1, "Responsible person surname is required."),
  id_number: z.string().min(3, "Responsible person ID number must be at least 3 characters."),
  date_of_birth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be in YYYY-MM-DD format."),
  marital_status: MaritalStatus,
  email: emailOptional,
  phone: e164,
  home_address: z.string().min(1, "Responsible person home address is required."),
  spouse_partner_phone: z.string().optional().or(z.literal("")),
  spouse_partner_work_phone: z.string().optional().or(z.literal("")),
  employer_name: z.string().optional().or(z.literal("")),
  occupation: z.string().optional().or(z.literal("")),
  work_address: z.string().optional().or(z.literal("")),
  work_phone: z.string().optional().or(z.literal("")),
});

// Section C — Medical aid
export const SectionC = z
  .object({
    same_as_responsible: z.boolean(),
    main_member_name: z.string().optional().or(z.literal("")),
    medical_aid_name: z.string().optional().or(z.literal("")), // free text, §15
    membership_number: z.string().optional().or(z.literal("")),
    plan: z.string().optional().or(z.literal("")),
    other_plan_detail: z.string().optional().or(z.literal("")),
    is_private_payer: z.boolean().default(false),
  })
  .refine((v) => v.is_private_payer || (!!v.medical_aid_name && !!v.membership_number && !!v.plan), {
    message: "Medical aid name, number, and plan are required unless private payer",
    path: ["medical_aid_name"],
  });

// Section D — Nearest family / friend
export const SectionD = z.object({
  name: z.string().min(1, "Emergency contact name is required."),
  relationship: z.string().min(1, "Emergency contact relationship is required."),
  address: z.string().optional().or(z.literal("")),
  email: emailOptional,
  phone: e164,
});

// Section E — Referred by
export const SectionE = z
  .object({
    referrer_type: ReferrerType,
    referrer_name: z.string().optional().or(z.literal("")),
    referrer_phone: z.string().optional().or(z.literal("")),
    referral_notes: z.string().optional().or(z.literal("")),
  })
  .refine((v) => v.referrer_type === "self" || !!v.referrer_name, {
    message: "Referrer name required",
    path: ["referrer_name"],
  })
  .refine((v) => v.referrer_type === "self" || !!v.referrer_phone, {
    message: "Referrer phone required",
    path: ["referrer_phone"],
  });

// Section F — Dependants
export const DependantSchema = z.object({
  name: z.string().min(1, "Dependant name is required."),
  sex: Sex,
  date_of_birth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Dependant date of birth must be in YYYY-MM-DD format."),
  dependant_code: z.string().min(1, "Dependant code is required."),
  allergies: z.string().optional().or(z.literal("")),
});

// Section G — Consent
export const ConsentCapture = z.object({
  consent_text_version: z.string().min(1, "Consent version is required."),
  consent_text_hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/, "Consent hash must be a valid SHA-256 hex value."),
  consent_summary_version: z.string().min(1, "Consent summary version is required."),
  signature_type: z.enum(["typed_name", "drawn_signature"], {
    errorMap: () => ({ message: "Please select a valid signature type." }),
  }),
  signature_value: z.string().min(1, "A signature is required before submitting."),
  patient_present_attestation: z.literal(true, {
    errorMap: () => ({ message: "Staff must attest patient was present" }),
  }),
});

// Full onboarding payload
export const OnboardingPayload = z
  .object({
    section_a: SectionA,
    section_b: SectionB,
    section_c: SectionC,
    section_d: SectionD,
    section_e: SectionE,
    dependants: z.array(DependantSchema).default([]),
    consent: ConsentCapture,
  })
  .superRefine((v, ctx) => {
    if (!v.section_a.is_minor) return;
    const b = v.section_b;

    if (!b.id_number?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Guardian/responsible party ID number is required for minors",
        path: ["section_b", "id_number"],
      });
    }
    if (!b.first_names?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Guardian/responsible party first names are required for minors",
        path: ["section_b", "first_names"],
      });
    }
    if (!b.surname?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Guardian/responsible party surname is required for minors",
        path: ["section_b", "surname"],
      });
    }
  });

export type OnboardingPayload = z.infer<typeof OnboardingPayload>;
