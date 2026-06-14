// A practice runs in a single regulatory/identity locale. This is the switch
// that drives the parts of onboarding that differ by country:
//   * identity rules — SA national ID (Luhn) vs US name + DOB (no national ID)
//   * payer model    — medical aid vs US insurance (subscriber/group)
//   * file numbering — hospital prefix vs practice MRN
//   * consent text   — POPIA vs HIPAA NPP / consent-to-treat
//
// Stored per practice in practice_settings. Defaults to "za" so every existing
// single-tenant SA deployment behaves exactly as before with no migration.
export type PracticeLocale = "za" | "us";

export const DEFAULT_PRACTICE_LOCALE: PracticeLocale = "za";

export function isPracticeLocale(value: unknown): value is PracticeLocale {
  return value === "za" || value === "us";
}

// Tolerant reader for the practice_settings value (free-form jsonb): unknown or
// missing → the SA default, so a misconfigured setting can never silently put a
// US practice on SA identity rules without the value being explicitly "us".
export function practiceLocaleFrom(value: unknown): PracticeLocale {
  return isPracticeLocale(value) ? value : DEFAULT_PRACTICE_LOCALE;
}
