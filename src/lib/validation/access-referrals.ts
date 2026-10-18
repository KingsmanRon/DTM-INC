// Reception's two decisions on a referral delivered by ACCESS.
import { z } from "zod";

// "self" is excluded: a referral that arrives through ACCESS always has a referrer.
export const AccessReferrerType = z.enum(["gp", "specialist", "hospital", "other"], {
  errorMap: () => ({ message: "Choose who referred the patient." }),
});

export const AcceptAccessReferralPayload = z
  .object({
    patient_id: z.string().uuid("Choose the patient file to link this referral to."),
    referrer_type: AccessReferrerType,
  })
  .strict();

export const DeclineAccessReferralPayload = z
  .object({
    reason: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(3, "Give a reason of at least 3 characters.").max(500, "Keep the reason under 500 characters.")),
  })
  .strict();
