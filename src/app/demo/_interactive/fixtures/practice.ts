import type { Facility, FacilityId } from "@/app/demo/_interactive/types";

/**
 * Fictional practice and hospitals. The hospital names are invented and none
 * corresponds to a real facility. The prefixes mirror how DTM issues file
 * numbers: {PREFIX}-{YYYY}-{SEQ}, with a separate sequence per hospital.
 */
export const PRACTICE = {
  name: "DTM Inc.",
  fileYear: "2026",
} as const;

export const FACILITIES: readonly Facility[] = [
  {
    id: "nth",
    name: "Northfield Demo Hospital",
    shortName: "Northfield",
    prefix: "NTH",
    locality: "Fictional Northfield",
    description: "Everyday surgical consulting and patient administration.",
  },
  {
    id: "jhb",
    name: "Jubilee Demo Hospital",
    shortName: "Jubilee",
    prefix: "JHB",
    locality: "Fictional Jubilee Park",
    description: "Referred patients, surgical follow-up and monthly billing batches.",
  },
];

export function facilityById(id: FacilityId): Facility {
  const facility = FACILITIES.find((f) => f.id === id);
  if (!facility) throw new Error(`Unknown hospital: ${id}`);
  return facility;
}

/** Fictional schemes. None correspond to a real medical scheme. */
export const SCHEMES = ["Demo Health Scheme", "Sample Medical Society", "Example Medical Aid"] as const;

/** Fictional practice users shown to the Administrator role. */
export const SIMULATED_USERS = [
  { name: "Dr Sipho Example", role: "Doctor", status: "Active" },
  { name: "Lindiwe Sample", role: "Reception/Staff", status: "Active" },
  { name: "Karen Sample", role: "Administrator", status: "Active" },
] as const;

export const TITLES = ["Mr", "Mrs", "Ms", "Miss", "Dr", "Prof"] as const;

export const REFERRAL_SOURCES = [
  { value: "gp", label: "General practitioner" },
  { value: "specialist", label: "Specialist" },
  { value: "hospital", label: "Hospital or clinic" },
  { value: "self", label: "Self-referred" },
  { value: "other", label: "Other" },
] as const;

/** "NTH-2026-000107" */
export function formatFileNumber(prefix: string, sequence: number): string {
  return `${prefix}-${PRACTICE.fileYear}-${String(sequence).padStart(6, "0")}`;
}

/** First sequence number not yet issued for each hospital in the seeded register. */
export const NEXT_FILE_SEQUENCE: Record<FacilityId, number> = { nth: 108, jhb: 67 };
