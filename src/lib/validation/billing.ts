// Zod schemas for the monthly billing export API. Shared between the route
// handlers (server) and could be reused client-side for pre-validation.
import { z } from "zod";

export const BillingHospital = z.enum(
  [
    "Nkanyezi Private Hospital",
    "Fountain Private Hospital",
    "Mediclinic Vereeniging Hospital",
    "Midvaal Private Hospital",
  ],
  { errorMap: () => ({ message: "Please select a valid hospital." }) },
);

// <input type="month"> value, e.g. "2026-06".
export const BillingMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be in YYYY-MM format.");

// A plain calendar date, or empty string to clear it.
const DateOrEmpty = z
  .string()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Date must be in YYYY-MM-DD format.")
  .or(z.literal(""));

export const StageBatchPayload = z.object({
  hospital: BillingHospital,
  month: BillingMonth,
  patient_ids: z.array(z.string().uuid()).min(1, "Select at least one patient.").max(500),
});
export type StageBatchPayload = z.infer<typeof StageBatchPayload>;

export const UpdateItemPayload = z
  .object({
    outgoing_date: DateOrEmpty.optional(),
    returned_date: DateOrEmpty.optional(),
  })
  .refine((v) => v.outgoing_date !== undefined || v.returned_date !== undefined, {
    message: "Provide outgoing_date and/or returned_date.",
  });
export type UpdateItemPayload = z.infer<typeof UpdateItemPayload>;

export const GenerateExportPayload = z.object({
  hospital: BillingHospital,
  month: BillingMonth,
  // Shared outgoing date stamped onto every row in the batch at generation time.
  outgoing_date: DateOrEmpty.optional(),
});
export type GenerateExportPayload = z.infer<typeof GenerateExportPayload>;
