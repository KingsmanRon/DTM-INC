import type { DemoState, Progress } from "@/app/demo/_interactive/types";
import { emptyDraft } from "@/app/demo/_interactive/state/onboarding";
import { NEXT_AUDIT_SEQUENCE, buildSeedAudit } from "./audit";
import { NEXT_BATCH_SEQUENCE, SEED_BATCHES } from "./billing";
import { NEXT_DOCUMENT_SEQUENCE, SEED_DOCUMENTS } from "./documents";
import { NEXT_NOTE_SEQUENCE, SEED_NOTES } from "./notes";
import { NEXT_PATIENT_SEQUENCE, SEED_PATIENTS } from "./patients";
import { NEXT_FILE_SEQUENCE } from "./practice";

export function initialProgress(): Progress {
  return {
    searched: false,
    duplicateBlocked: false,
    registered: false,
    documentPreviewed: false,
    documentAttached: false,
    noteCreated: false,
    noteFinalised: false,
    noteAmended: false,
    noteVoided: false,
    accessProbed: false,
    facilityFiltered: false,
    facilityReassigned: false,
    billingStaged: false,
    billingReady: false,
    exportGenerated: false,
    auditViewed: false,
    integrityVerified: false,
    rolesSeen: [],
  };
}

/**
 * Builds a fresh copy of the original synthetic dataset. Seed records are
 * deep-cloned so a reset can never be contaminated by earlier mutations.
 */
export function createInitialState(): DemoState {
  return {
    tick: 0,
    seq: {
      patient: NEXT_PATIENT_SEQUENCE,
      document: NEXT_DOCUMENT_SEQUENCE,
      note: NEXT_NOTE_SEQUENCE,
      audit: NEXT_AUDIT_SEQUENCE,
      batch: NEXT_BATCH_SEQUENCE,
    },
    fileSeq: { ...NEXT_FILE_SEQUENCE },
    patients: structuredClone(SEED_PATIENTS) as DemoState["patients"],
    documents: structuredClone(SEED_DOCUMENTS) as DemoState["documents"],
    notes: structuredClone(SEED_NOTES) as DemoState["notes"],
    audit: buildSeedAudit(),
    batches: structuredClone(SEED_BATCHES) as DemoState["batches"],
    draft: emptyDraft(),
    registration: { status: "idle" },
    progress: initialProgress(),
  };
}
