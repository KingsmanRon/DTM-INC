import type { AuditEvent } from "@/app/demo/_interactive/types";
import { makeAuditEvent, type AuditInput } from "@/app/demo/_interactive/state/audit";
import { SEED_PATIENTS } from "./patients";

const DOCTOR = { actorName: "Dr Sipho Example", actorRole: "doctor" } as const;
const STAFF = { actorName: "Lindiwe Sample (Reception)", actorRole: "staff" } as const;

/** File number as it stood when the event happened (current number unless noted). */
function file(patientId: string): string {
  const patient = SEED_PATIENTS.find((p) => p.id === patientId);
  if (!patient) throw new Error(`Unknown seeded patient: ${patientId}`);
  return patient.fileNumber;
}

type SeedEvent = Omit<AuditInput, "id">;

/**
 * Recent fictional activity, oldest first. Summaries describe what happened
 * and never include clinical content.
 */
const SEED_EVENTS: readonly SeedEvent[] = [
  { at: "2026-10-26T08:41:00+02:00", ...STAFF, action: "document.attached", target: file("p-0005"), subjectId: "p-0005", summary: "Medical aid card attached (sample document)" },
  { at: "2026-10-26T09:20:00+02:00", ...STAFF, action: "patient.amended", target: file("p-0006"), subjectId: "p-0006", summary: "Details amended: phone number" },
  { at: "2026-10-26T10:05:00+02:00", ...DOCTOR, action: "note.created", target: file("p-0004"), subjectId: "p-0004", summary: "Clinical note N-0001 created (draft)" },
  { at: "2026-10-26T10:32:00+02:00", ...DOCTOR, action: "note.finalised", target: file("p-0004"), subjectId: "p-0004", summary: "Clinical note N-0001 finalised (version 1)" },
  { at: "2026-10-27T08:15:00+02:00", ...STAFF, action: "patient.created", target: file("p-0012"), subjectId: "p-0012", summary: "Patient registered at Jubilee Demo Hospital" },
  { at: "2026-10-27T08:19:00+02:00", ...STAFF, action: "document.attached", target: file("p-0012"), subjectId: "p-0012", summary: "Referral letter attached (sample document)" },
  { at: "2026-10-27T11:47:00+02:00", ...DOCTOR, action: "note.amended", target: file("p-0004"), subjectId: "p-0004", summary: "Clinical note N-0001 amended (version 2)" },
  {
    at: "2026-10-27T14:02:00+02:00",
    ...STAFF,
    action: "patient.facility_reassigned",
    target: file("p-0009"),
    subjectId: "p-0009",
    summary: `File moved from Northfield Demo Hospital to Jubilee Demo Hospital. New file number ${file("p-0009")}; NTH-2026-000106 is retired but stays searchable`,
  },
  { at: "2026-10-27T15:30:00+02:00", ...STAFF, action: "billing.batch_prepared", target: "Batch b-0003", summary: "October 2026 file batch prepared for Jubilee Demo Hospital" },
  { at: "2026-10-27T15:34:00+02:00", ...STAFF, action: "billing.files_added", target: "Batch b-0003", summary: "2 files added to the October 2026 batch" },
  { at: "2026-10-27T16:20:00+02:00", ...DOCTOR, action: "note.created", target: file("p-0001"), subjectId: "p-0001", summary: "Clinical note N-0004 created (draft)" },
  { at: "2026-10-27T16:24:00+02:00", ...DOCTOR, action: "note.finalised", target: file("p-0001"), subjectId: "p-0001", summary: "Clinical note N-0004 finalised (version 1)" },
  { at: "2026-10-28T08:05:00+02:00", ...DOCTOR, action: "note.voided", target: file("p-0001"), subjectId: "p-0001", summary: "Clinical note N-0004 voided (reason recorded)" },
  { at: "2026-10-28T08:40:00+02:00", ...DOCTOR, action: "note.created", target: file("p-0004"), subjectId: "p-0004", summary: "Clinical note N-0002 created (draft)" },
];

export function buildSeedAudit(): AuditEvent[] {
  const events: AuditEvent[] = [];
  SEED_EVENTS.forEach((seed, index) => {
    events.push(
      makeAuditEvent(events[events.length - 1], { ...seed, id: `a-${String(index + 1).padStart(4, "0")}` }),
    );
  });
  return events;
}

export const NEXT_AUDIT_SEQUENCE = SEED_EVENTS.length + 1;
