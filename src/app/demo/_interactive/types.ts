/**
 * Domain model for the in-memory demonstration. Every value is synthetic.
 * Nothing in this file talks to a network, a database or browser storage.
 */

export type Role = "doctor" | "staff" | "admin";

export type SceneId =
  | "dashboard"
  | "patients"
  | "onboarding"
  | "documents"
  | "notes"
  | "facilities"
  | "billing"
  | "audit";

export type DemoMode = "tour" | "explore";

export type PatientTab = "overview" | "documents" | "notes";

export type FacilityId = "nth" | "jhb";

/** A (fictional) hospital. Its prefix is the first part of every file number issued there. */
export interface Facility {
  id: FacilityId;
  name: string;
  shortName: string;
  prefix: string;
  locality: string;
  description: string;
}

/** A file number that was retired when the patient was moved to another hospital. */
export interface FormerFileNumber {
  number: string;
  facilityId: FacilityId;
  retiredAt: string;
}

export type IdType = "id" | "passport";
export type ReferralSource = "gp" | "specialist" | "hospital" | "self" | "other";

export type Payer =
  | { kind: "medical_aid"; scheme: string; membershipNumber: string; plan: string }
  | { kind: "private" };

export interface Dependant {
  name: string;
  dateOfBirth: string;
  code: string;
}

export interface PatientAmendment {
  at: string;
  actor: string;
  field: string;
  from: string;
  to: string;
}

export interface FacilityAssignment {
  at: string;
  actor: string;
  facilityId: FacilityId;
  note: string;
}

export interface Patient {
  id: string;
  fileNumber: string;
  /** Retired numbers: never reissued, and still searchable. */
  formerFileNumbers: FormerFileNumber[];
  title: string;
  firstNames: string;
  surname: string;
  idType: IdType;
  /** Synthetic identifier, e.g. "SYN-ID-10001". Never a genuine national ID. */
  idNumber: string;
  dateOfBirth: string;
  phone: string;
  email: string;
  address: string;
  facilityId: FacilityId;
  recordStatus: "active" | "archived";
  payer: Payer;
  responsible: {
    sameAsPatient: boolean;
    name: string;
    relationship: string;
    idNumber: string;
    phone: string;
    address: string;
  };
  emergency: { name: string; relationship: string; phone: string; email: string };
  referral: { source: ReferralSource; name: string; phone: string; notes: string };
  dependants: Dependant[];
  consent: { agreed: boolean; signedName: string; wordingVersion: string; capturedAt: string };
  createdAt: string;
  amendments: PatientAmendment[];
  assignments: FacilityAssignment[];
}

export type DocumentCategory =
  | "id_copy"
  | "medical_aid_card"
  | "consent_form"
  | "referral_letter"
  | "correspondence";

export interface SampleDocumentTemplate {
  id: string;
  title: string;
  category: DocumentCategory;
  fileName: string;
  sizeLabel: string;
  description: string;
}

export interface DocumentHistoryEntry {
  at: string;
  actor: string;
  action: "attached" | "verified" | "archived";
  detail: string;
}

export interface PatientDocument {
  id: string;
  patientId: string;
  templateId: string;
  title: string;
  category: DocumentCategory;
  fileName: string;
  sizeLabel: string;
  status: "on_file" | "archived";
  attachedAt: string;
  attachedBy: string;
  history: DocumentHistoryEntry[];
}

export interface NoteVersion {
  version: number;
  kind: "original" | "amendment";
  body: string;
  author: string;
  savedAt: string;
  finalisedAt: string | null;
  /** Why an amendment was made. Required for amendments. */
  reason: string;
}

export interface ClinicalNote {
  id: string;
  patientId: string;
  status: "draft" | "finalised" | "voided";
  versions: NoteVersion[];
  createdAt: string;
  voided: { at: string; by: string; reason: string } | null;
}

export type AuditCategory = "patient" | "document" | "clinical" | "facility" | "billing";

export type AuditAction =
  | "patient.created"
  | "patient.amended"
  | "patient.facility_reassigned"
  | "document.attached"
  | "document.archived"
  | "note.created"
  | "note.saved"
  | "note.finalised"
  | "note.amended"
  | "note.voided"
  | "billing.files_added"
  | "billing.batch_prepared"
  | "billing.batch_ready"
  | "billing.handover_recorded"
  | "billing.batch_returned";

export interface AuditEvent {
  id: string;
  at: string;
  actorName: string;
  actorRole: Role;
  action: AuditAction;
  category: AuditCategory;
  /** Human-readable target, e.g. a file number. Never clinical content. */
  target: string;
  /** The patient the event concerns, when there is one. */
  subjectId?: string;
  /** Metadata only: describes what happened, never what a note says. */
  summary: string;
  /** Illustrative reference code used by the simulated integrity check. */
  ref: string;
  prevRef: string;
}

export type PayerKind = "cash" | "member" | "missing";

export interface BillingItem {
  patientId: string;
  fileNumber: string;
  patientName: string;
  payerKind: PayerKind;
  /** "CASH", the membership number, or "" when the number was never captured. */
  payerLabel: string;
  addedAt: string;
}

export type BatchStatus = "preparing" | "ready" | "handed_over" | "returned";

export interface BillingBatch {
  id: string;
  facilityId: FacilityId;
  /** "YYYY-MM" */
  month: string;
  status: BatchStatus;
  items: BillingItem[];
  createdAt: string;
  readyAt: string | null;
  outgoingAt: string | null;
  returnedAt: string | null;
  recipient: string;
}

export interface OnboardingDraft {
  patient: {
    facilityId: FacilityId | "";
    title: string;
    firstNames: string;
    surname: string;
    idType: IdType;
    idNumber: string;
    dateOfBirth: string;
    phone: string;
    email: string;
    address: string;
  };
  responsible: {
    sameAsPatient: boolean;
    name: string;
    relationship: string;
    idNumber: string;
    phone: string;
    address: string;
  };
  payer: { kind: "medical_aid" | "private" | ""; scheme: string; membershipNumber: string; plan: string };
  emergency: { name: string; relationship: string; phone: string; email: string };
  referral: { source: ReferralSource | ""; name: string; phone: string; notes: string };
  dependants: Dependant[];
  dependantInput: Dependant;
  consent: { agreed: boolean; signedName: string };
}

export type RegistrationResult =
  | { status: "idle" }
  | { status: "success"; patientId: string }
  | { status: "blocked"; existingPatientId: string };

/** Milestones used by the guided tour to tick off "try it" checkpoints. */
export interface Progress {
  searched: boolean;
  duplicateBlocked: boolean;
  registered: boolean;
  documentPreviewed: boolean;
  documentAttached: boolean;
  noteCreated: boolean;
  noteFinalised: boolean;
  noteAmended: boolean;
  noteVoided: boolean;
  accessProbed: boolean;
  facilityFiltered: boolean;
  facilityReassigned: boolean;
  billingStaged: boolean;
  billingReady: boolean;
  exportGenerated: boolean;
  auditViewed: boolean;
  integrityVerified: boolean;
  rolesSeen: Role[];
}

export interface DemoState {
  /** Advances with every audited action; drives deterministic timestamps. */
  tick: number;
  seq: { patient: number; document: number; note: number; audit: number; batch: number };
  /** Next file number sequence per hospital prefix. */
  fileSeq: Record<FacilityId, number>;
  patients: Patient[];
  documents: PatientDocument[];
  notes: ClinicalNote[];
  audit: AuditEvent[];
  batches: BillingBatch[];
  draft: OnboardingDraft;
  registration: RegistrationResult;
  progress: Progress;
}
