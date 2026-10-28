import type { ClinicalNote } from "@/app/demo/_interactive/types";

/**
 * Fictional doctor-only clinical notes. The text is generic placeholder prose
 * with no real clinical meaning. These records only ever reach the Doctor
 * role: see `projectForRole`.
 */
const DOCTOR = "Dr Sipho Example";

export const SEED_NOTES: readonly ClinicalNote[] = [
  {
    id: "n-0001",
    patientId: "p-0004",
    status: "finalised",
    createdAt: "2026-10-26T10:05:00+02:00",
    voided: null,
    versions: [
      {
        version: 1,
        kind: "original",
        body: "Review consultation (fictional). Patient reports steady progress since the previous visit. Plan: continue the current routine and review again in six weeks.",
        author: DOCTOR,
        savedAt: "2026-10-26T10:05:00+02:00",
        finalisedAt: "2026-10-26T10:32:00+02:00",
        reason: "",
      },
      {
        version: 2,
        kind: "amendment",
        body: "Review consultation (fictional). Patient reports steady progress since the previous visit. Plan: continue the current routine and review again in four weeks.",
        author: DOCTOR,
        savedAt: "2026-10-27T11:47:00+02:00",
        finalisedAt: "2026-10-27T11:47:00+02:00",
        reason: "Follow-up interval corrected from six weeks to four weeks.",
      },
    ],
  },
  {
    id: "n-0002",
    patientId: "p-0004",
    status: "draft",
    createdAt: "2026-10-28T08:40:00+02:00",
    voided: null,
    versions: [
      {
        version: 1,
        kind: "original",
        body: "Follow-up discussion (fictional draft). Awaiting the sample results before completing this note.",
        author: DOCTOR,
        savedAt: "2026-10-28T08:40:00+02:00",
        finalisedAt: null,
        reason: "",
      },
    ],
  },
  {
    id: "n-0003",
    patientId: "p-0002",
    status: "finalised",
    createdAt: "2026-09-18T14:10:00+02:00",
    voided: null,
    versions: [
      {
        version: 1,
        kind: "original",
        body: "Initial consultation (fictional). History recorded and referral letter reviewed. No further action required at this visit.",
        author: DOCTOR,
        savedAt: "2026-09-18T14:10:00+02:00",
        finalisedAt: "2026-09-18T14:25:00+02:00",
        reason: "",
      },
    ],
  },
  {
    id: "n-0004",
    patientId: "p-0001",
    status: "voided",
    createdAt: "2026-10-27T16:20:00+02:00",
    voided: {
      at: "2026-10-28T08:05:00+02:00",
      by: DOCTOR,
      reason: "Entered on the wrong patient file; recorded again on the correct file.",
    },
    versions: [
      {
        version: 1,
        kind: "original",
        body: "Brief telephone consultation (fictional). Entered in error on this file.",
        author: DOCTOR,
        savedAt: "2026-10-27T16:20:00+02:00",
        finalisedAt: "2026-10-27T16:24:00+02:00",
        reason: "",
      },
    ],
  },
];

export const NEXT_NOTE_SEQUENCE = 5;
