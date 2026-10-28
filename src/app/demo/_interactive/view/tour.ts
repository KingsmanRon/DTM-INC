import type { DemoState, PatientTab, Role, SceneId } from "@/app/demo/_interactive/types";

/**
 * Guided tour script. Edit this file to change the demonstration scenarios,
 * their order, the explanatory copy or the "try it" checkpoints. Each step
 * names the scene and simulated role it opens with.
 *
 * `patientId: "recent"` opens the patient registered during the tour if there
 * is one, otherwise the fallback seeded patient.
 */

export interface TourCheckpoint {
  id: string;
  label: string;
  done: (state: DemoState) => boolean;
}

export interface TourStep {
  id: string;
  /** Workflow letter from the product brief, shown as a small eyebrow. */
  workflow: string;
  title: string;
  summary: string;
  instructions: string[];
  scene: SceneId;
  role: Role;
  patientId?: string;
  tab?: PatientTab;
  checkpoints: TourCheckpoint[];
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "search",
    workflow: "Patient search and duplicate prevention",
    title: "Find the patient. Stop the duplicate.",
    summary:
      "Reception searches the practice register by name, identifier or file number. If the patient already has a file, creating a second one is blocked and the existing file opens instead.",
    instructions: [
      "Search for “Dube”, the identifier SYN-ID-10004 or a file number.",
      "Choose New patient and run the identity check with SYN-ID-10004.",
      "Open the existing file instead of creating another.",
    ],
    scene: "patients",
    role: "staff",
    checkpoints: [
      { id: "searched", label: "Search the register", done: (s) => s.progress.searched },
      { id: "duplicate", label: "See the duplicate blocked", done: (s) => s.progress.duplicateBlocked },
    ],
  },
  {
    id: "onboarding",
    workflow: "Seven-step patient onboarding",
    title: "Register a patient in seven steps",
    summary:
      "Digital onboarding replaces the paper form. Each section is checked before the next, and the patient file is only created when everything is complete.",
    instructions: [
      "Press “Use sample data” on a step, then Continue. Try Continue on an empty step to see the checks.",
      "Review everything on the last step and complete the registration.",
      "A fictional file number is generated and the patient joins the register.",
    ],
    scene: "onboarding",
    role: "staff",
    checkpoints: [{ id: "registered", label: "Complete a registration", done: (s) => s.progress.registered }],
  },
  {
    id: "documents",
    workflow: "Patient registry and documents",
    title: "Keep every document with the patient",
    summary:
      "Referral letters, medical aid cards, identity copies and consent forms live on the patient file, with a history of who attached what and when. This demonstration only offers bundled sample documents.",
    instructions: [
      "Preview a sample document.",
      "Attach a sample document and watch the list and checklist update.",
      "Archive a document: it stays in the history rather than disappearing.",
    ],
    scene: "documents",
    role: "staff",
    patientId: "recent",
    checkpoints: [
      { id: "preview", label: "Preview a sample document", done: (s) => s.progress.documentPreviewed },
      { id: "attach", label: "Attach a sample document", done: (s) => s.progress.documentAttached },
    ],
  },
  {
    id: "notes",
    workflow: "Clinical notes",
    title: "Doctor-controlled clinical notes",
    summary:
      "A doctor writes a note, finalises it, and amends it later without losing the original. Voiding needs a reason. Every action lands in the audit timeline.",
    instructions: [
      "Write a note and save it as a draft.",
      "Finalise it, then amend it with a reason.",
      "Open the version history to see the original and the amendment side by side.",
      "Void a note and record why.",
    ],
    scene: "notes",
    role: "doctor",
    patientId: "p-0004",
    checkpoints: [
      { id: "created", label: "Save a note", done: (s) => s.progress.noteCreated },
      { id: "finalised", label: "Finalise it", done: (s) => s.progress.noteFinalised },
      { id: "amended", label: "Amend it", done: (s) => s.progress.noteAmended },
      { id: "voided", label: "Void a note with a reason", done: (s) => s.progress.noteVoided },
    ],
  },
  {
    id: "roles",
    workflow: "Role-based access",
    title: "The right access for each role",
    summary:
      "Reception handles registration and documents but never sees clinical notes. Doctor-only content is not just hidden from the menu: it is absent from the Reception and Administrator views entirely.",
    instructions: [
      "You are Reception/Staff. Notice there is no Clinical Notes section.",
      "Try opening Clinical Notes directly. Nothing is revealed.",
      "Switch to Doctor and back to compare.",
    ],
    scene: "patients",
    role: "staff",
    patientId: "p-0004",
    checkpoints: [
      { id: "switch", label: "Switch between roles", done: (s) => s.progress.rolesSeen.length >= 2 },
      { id: "probe", label: "Try opening Clinical Notes as Reception", done: (s) => s.progress.accessProbed },
    ],
  },
  {
    id: "locations",
    workflow: "Hospitals",
    title: "One practice, several hospitals",
    summary:
      "Each hospital issues its own file numbers. Moving a patient to another hospital issues a new number under that hospital's prefix, retires the old one for good, and keeps the old number searchable.",
    instructions: [
      "Filter the register by hospital.",
      "Move a patient to the other hospital and read their new file number in the history.",
      "Search for the retired number: it still finds the patient.",
    ],
    scene: "facilities",
    role: "staff",
    checkpoints: [
      { id: "filter", label: "Filter by hospital", done: (s) => s.progress.facilityFiltered },
      { id: "reassign", label: "Move a patient to another hospital", done: (s) => s.progress.facilityReassigned },
    ],
  },
  {
    id: "billing",
    workflow: "Billing File Tracking",
    title: "Billing File Tracking",
    summary:
      "Track which patient files go to your external billing company each month, hospital by hospital. This is file tracking only: it does not submit claims, calculate tariffs, invoice or process payments.",
    instructions: [
      "Choose a hospital and add patient files to the monthly batch.",
      "Mark the batch ready, then record the handover.",
      "Generate the sample export (fictional data).",
    ],
    scene: "billing",
    role: "staff",
    checkpoints: [
      { id: "stage", label: "Add files to a batch", done: (s) => s.progress.billingStaged },
      { id: "ready", label: "Mark a batch ready", done: (s) => s.progress.billingReady },
      { id: "export", label: "Generate the sample export", done: (s) => s.progress.exportGenerated },
    ],
  },
  {
    id: "audit",
    workflow: "Audit and records accountability",
    title: "Know who changed what, and when",
    summary:
      "Everything you did in this tour appears in the timeline, with the person and time. Entries describe actions, never clinical content. The integrity check here is a simulation for illustration.",
    instructions: [
      "Scan the timeline for the actions you just performed.",
      "Run the simulated integrity check, then simulate an edit to a past entry.",
    ],
    scene: "audit",
    role: "admin",
    checkpoints: [
      { id: "viewed", label: "Review the timeline", done: (s) => s.progress.auditViewed },
      { id: "verified", label: "Run the simulated integrity check", done: (s) => s.progress.integrityVerified },
    ],
  },
  {
    id: "next",
    workflow: "Next steps",
    title: "See it with your own practice in mind",
    summary:
      "That is the core of DTM Inc. Request a personalised demonstration to talk through your practice, your hospitals and what you need, or keep exploring freely.",
    instructions: [],
    scene: "dashboard",
    role: "doctor",
    checkpoints: [],
  },
];

export const TOUR_LENGTH = TOUR_STEPS.length;
