// US patient identity (locale "us"). Counterpart to sa-id.ts.
//
// Unlike SA, the US has no national ID number to validate or to dedupe on, and
// it is not derivable to a DOB. So US identity anchors on **name + date of
// birth**, with the last 4 of the SSN as an OPTIONAL disambiguator only.
//
// Deliberately NOT collected: the full SSN. It is a breach-liability magnet
// (HIPAA + state law), and it is not needed for the record or the superbill —
// the de-facto billing identifier is the insurance subscriber ID, captured in
// the (separate) insurance section, not here.
import { z } from "zod";

// A real calendar date, not in the future, within ~120 years. Rejects things
// like 2021-02-30 that pass a regex but aren't real dates.
export function isPlausibleDob(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // Fixed offsets: the regex above already guarantees YYYY-MM-DD, so these
  // always yield numbers (avoids the noUncheckedIndexedAccess undefineds a
  // split()+destructure would introduce).
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(5, 7));
  const d = Number(value.slice(8, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return false; // overflowed (e.g. Feb 30) → not a real date
  }
  const now = Date.now();
  if (dt.getTime() > now) return false; // not born in the future
  const years = (now - dt.getTime()) / (365.25 * 24 * 3600 * 1000);
  return years <= 120;
}

export const usDateOfBirth = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be in YYYY-MM-DD format.")
  .refine(isPlausibleDob, "Enter a valid date of birth (a real date, not in the future).");

export const usSsnLast4 = z
  .string()
  .regex(/^\d{4}$/, "Enter exactly the last 4 digits of the SSN.");

// US patient identity fragment — the locale-"us" replacement for the SA-ID /
// passport block in SectionA. Shared by the wizard (client) and the API/RPC
// (server) once the onboarding payload becomes locale-aware.
export const UsPatientIdentity = z.object({
  first_names: z.string().min(1, "Patient first name is required."),
  surname: z.string().min(1, "Patient last name is required."),
  date_of_birth: usDateOfBirth,
  // Optional; empty string is treated as "not provided".
  ssn_last4: usSsnLast4.optional().or(z.literal("")),
});
export type UsPatientIdentity = z.infer<typeof UsPatientIdentity>;

// SOFT duplicate-match key for US patients. With no national ID, likely-the-same
// patient (retries, double-submits, re-registration) is detected on normalized
// name + DOB, plus SSN last-4 when present.
//
// IMPORTANT: this is a WARN key, NOT a uniqueness rule. Unlike an SA national ID
// (unique → hard unique index, migration 0031), name + DOB is genuinely NOT
// unique — distinct real people share them — so a hard constraint would block
// registering a legitimate second patient. The DB therefore has only a
// NON-UNIQUE lookup index (migration 0055); the app uses this key to surface
// possible matches for the user to confirm or override.
export function usIdentityDedupeKey(identity: {
  first_names: string;
  surname: string;
  date_of_birth: string;
  ssn_last4?: string | null;
}): string {
  const norm = (s: string) => s.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  const ssn = (identity.ssn_last4 ?? "").trim();
  return [
    norm(identity.first_names),
    norm(identity.surname),
    identity.date_of_birth.trim(),
    ssn,
  ].join("|");
}
