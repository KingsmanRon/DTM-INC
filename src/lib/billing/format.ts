// Pure, isomorphic helpers for the monthly billing export. No node/server-only
// imports here — both the API routes and the client billing page import these,
// so the filename/slug/date rules stay in one place.

export const BILLING_HOSPITALS = [
  "Nkanyezi Private Hospital",
  "Fountain Private Hospital",
  "Mediclinic Vereeniging Hospital",
  "Midvaal Private Hospital",
] as const;

export type BillingHospital = (typeof BILLING_HOSPITALS)[number];

// Hospital -> file-number prefix (set together at onboarding, see migration
// 0013). Used to scope the shared patient search to the selected hospital.
export const HOSPITAL_FILE_PREFIX: Record<string, string> = {
  "Nkanyezi Private Hospital": "NKA",
  "Fountain Private Hospital": "FOU",
  "Mediclinic Vereeniging Hospital": "MED",
  "Midvaal Private Hospital": "MID",
};

const MONTH_NAMES = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

// "2026-06" -> "2026-06-01" (first day of month). Returns null on bad input so
// callers can reject rather than guess.
export function monthInputToFirstDay(monthInput: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(monthInput.trim());
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

// "2026-06-01" -> "2026-06" for the <input type="month"> control.
export function firstDayToMonthInput(firstDay: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(firstDay.trim());
  return m ? `${m[1]}-${m[2]}` : "";
}

// Format a stored YYYY-MM-DD date as "03 JUNE 2026" (DD MMMM YYYY, month upper
// case) to match the existing paper artifact. Parsed by parts — never via
// `new Date(str)` — so a date column is not shifted by the runtime time zone.
// Blank / null dates stay blank.
export function formatBillingDate(value: string | null | undefined): string {
  if (!value) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return "";
  const year = m[1];
  const month = Number(m[2]);
  const day = m[3];
  if (month < 1 || month > 12) return "";
  return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

// "June 2026" label for headings.
export function monthLabel(firstDayOrMonthInput: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(firstDayOrMonthInput.trim());
  if (!m) return "";
  const month = Number(m[2]);
  if (month < 1 || month > 12) return "";
  const name = MONTH_NAMES[month - 1];
  if (!name) return "";
  return `${name.charAt(0)}${name.slice(1).toLowerCase()} ${m[1]}`;
}

// "FIRST [MIDDLE/INITIAL] SURNAME" with the middle component preserved (the
// sample has "MBUYISWA J NHLAPO", "DANIEL K MOFOKENG"). first_names is stored
// already containing any middle names/initials, so we keep it intact and just
// append the surname, collapsing stray whitespace.
export function assemblePatientName(
  firstNames: string | null | undefined,
  surname: string | null | undefined,
): string {
  return [firstNames ?? "", surname ?? ""]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

// Slug for the filename. Strips a trailing "(Private )Hospital" suffix and
// slugifies the distinctive part, so long hospital names collapse cleanly:
//   "Nkanyezi Private Hospital"        -> "nkanyezi"
//   "Mediclinic Vereeniging Hospital"  -> "mediclinic-vereeniging"
export function hospitalSlug(hospital: string): string {
  const base = hospital
    .toLowerCase()
    .replace(/\b(private\s+)?hospital\b/g, " ")
    .trim();
  const slug = base
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "practice";
}

// billing-export-nkanyezi-2026-06.xlsx
export function billingFilename(hospital: string, monthInputOrFirstDay: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(monthInputOrFirstDay.trim());
  const ym = m ? `${m[1]}-${m[2]}` : "unknown";
  return `billing-export-${hospitalSlug(hospital)}-${ym}.xlsx`;
}

// Column headers in the spreadsheet, in order. ID/Passport and Medical Aid
// Number are first-class columns — the whole point is that they are populated
// from the patient record, not left blank (Constraints 3.2).
export const BILLING_COLUMNS = [
  "File Number",
  "Patient Name",
  "ID / Passport Number",
  "Medical Aid Number",
  "Outgoing Date",
  "Returned Date",
] as const;
