// The referral ACCESS delivers (access-referral-delivery.v1). The schema is
// strict: an unknown field is a contract change, not something to store.
// Only what reception needs to recognise and file the referral is accepted;
// ACCESS keeps the referral documents, and v1 transfers none.
import { createHash } from "node:crypto";
import { z } from "zod";

export const DELIVERY_SCHEMA_VERSION = "access-referral-delivery.v1";
export const RECEIPT_SCHEMA_VERSION = "access-referral-receipt.v1";
/** Largest delivery body accepted, in bytes. A referral is well under 16 KB. */
export const MAX_DELIVERY_BYTES = 64 * 1024;

export const ACCESS_DOCUMENT_TYPES = [
  "referral_letter",
  "insurance",
  "demographics",
  "medical_aid_card",
  "identity_document",
  "consent_form",
  "prior_results",
] as const;

const NO_CONTROL = /^[^\u0000-\u001f\u007f]+$/;
const TEXT_BLOCK = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;

function isCalendarDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .refine(isCalendarDate, "Not a calendar date.");

const name = z.string().trim().min(1).max(200).regex(NO_CONTROL);

export const DeliveryReferral = z
  .object({
    case_reference: z.string().regex(/^REF-[0-9A-F]{8}$/),
    referral_id: z.string().uuid(),
    received_at: z.string().datetime({ offset: true }),
    patient: z
      .object({
        given_name: name,
        family_name: name,
        date_of_birth: calendarDate,
        identifier: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9][A-Za-z0-9 /-]{0,99}$/)
          .optional(),
      })
      .strict(),
    referrer: z.object({ name }).strict(),
    reason: z.string().max(4000).regex(TEXT_BLOCK).optional(),
    requested_service: z.string().regex(/^[A-Z0-9_]{2,64}$/).optional(),
    referral_date: calendarDate.optional(),
    funding: z
      .object({
        type: z.enum(["MEDICAL_AID", "SELF_PAY", "OTHER", "UNKNOWN"]),
        scheme: z.string().trim().min(1).max(120).regex(NO_CONTROL).optional(),
      })
      .strict()
      .optional(),
    documents_held: z.array(z.enum(ACCESS_DOCUMENT_TYPES)).max(ACCESS_DOCUMENT_TYPES.length),
  })
  .strict();

export const DeliveryRequest = z
  .object({
    schema_version: z.literal(DELIVERY_SCHEMA_VERSION),
    execution_id: z.string().uuid(),
    correlation_id: z.string().uuid(),
    access_tenant_id: z.string().uuid(),
    data_mode: z.enum(["SYNTHETIC", "REAL"]),
    referral: DeliveryReferral,
  })
  .strict();

export type DeliveryRequest = z.infer<typeof DeliveryRequest>;

// Key-sorted JSON so the same delivery always hashes the same, whatever the
// sender's key order or whitespace.
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
}

/** Hash of the parsed delivery: a replay matches; a changed delivery conflicts. */
export function deliveryHash(delivery: DeliveryRequest): string {
  return createHash("sha256").update(canonicalJson(delivery), "utf8").digest("hex");
}
