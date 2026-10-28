import { EXPECTED_CATEGORIES } from "@/app/demo/_interactive/fixtures/documents";
import { FACILITIES } from "@/app/demo/_interactive/fixtures/practice";
import type {
  AuditEvent,
  BatchStatus,
  BillingBatch,
  ClinicalNote,
  DemoState,
  DocumentCategory,
  FacilityId,
  OnboardingDraft,
  Patient,
  PatientDocument,
  RegistrationResult,
  Role,
} from "@/app/demo/_interactive/types";
import { SESSION_START } from "./clock";
import { emptyDraft, normaliseIdentifier } from "./onboarding";
import { can } from "./permissions";

/** Non-identifying counts that every role may see (reporting only). */
export interface Aggregates {
  activePatients: number;
  archivedPatients: number;
  byFacility: Record<FacilityId, number>;
  documentsOnFile: number;
  auditEventCount: number | null;
  registeredThisSession: number;
  documentsAttachedThisSession: number;
  /** Present for the Doctor role only. */
  clinical: { drafts: number; finalised: number; amended: number; voided: number } | null;
  /** Present for roles that can use Billing File Tracking. */
  billing: Record<BatchStatus, number> | null;
}

/**
 * Everything a given role is allowed to see. UI components receive this
 * projection and never the raw state, so doctor-only notes cannot reach a
 * Reception or Administrator view by any route, only by being absent here.
 */
export interface RoleModel {
  role: Role;
  patients: readonly Patient[];
  documents: readonly PatientDocument[];
  /** Always empty unless the role may read clinical notes. */
  notes: readonly ClinicalNote[];
  /** Newest first. Empty unless the role may view the audit trail. */
  audit: readonly AuditEvent[];
  /**
   * Newest-first record of actions taken on clinical notes (actions only,
   * never note text). Empty unless the role may read clinical notes.
   */
  clinicalActivity: readonly AuditEvent[];
  batches: readonly BillingBatch[];
  draft: OnboardingDraft;
  registration: RegistrationResult;
  aggregates: Aggregates;
}

export function projectForRole(state: DemoState, role: Role): RoleModel {
  const canNotes = can(role, "notes.view");
  const canBilling = can(role, "billing.view");
  const canRegister = can(role, "patients.register");

  const active = state.patients.filter((p) => p.recordStatus === "active");
  const byFacility: Record<FacilityId, number> = { nth: 0, jhb: 0 };
  for (const p of active) byFacility[p.facilityId] += 1;

  const clinical = canNotes
    ? {
        drafts: state.notes.filter((n) => n.status === "draft").length,
        finalised: state.notes.filter((n) => n.status === "finalised").length,
        amended: state.notes.filter((n) => n.status === "finalised" && n.versions.length > 1).length,
        voided: state.notes.filter((n) => n.status === "voided").length,
      }
    : null;

  let billing: Record<BatchStatus, number> | null = null;
  if (canBilling) {
    billing = { preparing: 0, ready: 0, handed_over: 0, returned: 0 };
    for (const b of state.batches) billing[b.status] += 1;
  }

  return {
    role,
    patients: can(role, "patients.view") ? state.patients : [],
    documents: can(role, "documents.view") ? state.documents : [],
    notes: canNotes ? state.notes : [],
    audit: can(role, "audit.view") ? [...state.audit].reverse() : [],
    clinicalActivity: canNotes ? state.audit.filter((e) => e.category === "clinical").reverse() : [],
    batches: canBilling ? state.batches : [],
    draft: canRegister ? state.draft : emptyDraft(),
    registration: canRegister ? state.registration : { status: "idle" },
    aggregates: {
      activePatients: active.length,
      archivedPatients: state.patients.length - active.length,
      byFacility,
      documentsOnFile: state.documents.filter((d) => d.status === "on_file").length,
      auditEventCount: can(role, "audit.view") ? state.audit.length : null,
      registeredThisSession: state.patients.filter((p) => p.createdAt >= SESSION_START).length,
      documentsAttachedThisSession: state.documents.filter((d) => d.attachedAt >= SESSION_START).length,
      clinical,
      billing,
    },
  };
}

export function patientName(patient: Pick<Patient, "title" | "firstNames" | "surname">): string {
  return `${patient.firstNames} ${patient.surname}`;
}

export function patientListName(patient: Pick<Patient, "firstNames" | "surname">): string {
  return `${patient.surname}, ${patient.firstNames}`;
}

/**
 * Searches the register by name, synthetic identifier or file number
 * (full or partial). Needs at least two characters.
 */
export function searchPatients(patients: readonly Patient[], rawQuery: string): Patient[] {
  const query = rawQuery.trim().toLowerCase();
  if (query.length < 2) return [];
  const compact = normaliseIdentifier(query);
  const tokens = query.split(/\s+/).filter(Boolean);

  const scored = patients
    .map((patient) => {
      const name = `${patient.firstNames} ${patient.surname}`.toLowerCase();
      const id = normaliseIdentifier(patient.idNumber);
      const file = normaliseIdentifier(patient.fileNumber);
      const former = patient.formerFileNumbers.map((f) => normaliseIdentifier(f.number));
      let score = 0;
      if (compact && (compact === id || compact === file || former.includes(compact))) score = 100;
      else if (tokens.every((token) => name.includes(token))) score = patient.surname.toLowerCase().startsWith(tokens[0] ?? "") ? 80 : 70;
      else if (compact.length >= 3 && (id.includes(compact) || file.includes(compact) || former.some((f) => f.includes(compact)))) score = 50;
      return { patient, score };
    })
    .filter((entry) => entry.score > 0);

  scored.sort((a, b) => b.score - a.score || a.patient.surname.localeCompare(b.patient.surname));
  return scored.map((entry) => entry.patient);
}

/** The retired file number a search matched, if the query was one of a patient's former numbers. */
export function formerNumberMatch(patient: Pick<Patient, "formerFileNumbers" | "fileNumber">, rawQuery: string): string | null {
  const compact = normaliseIdentifier(rawQuery.trim());
  if (compact.length < 3 || normaliseIdentifier(patient.fileNumber).includes(compact)) return null;
  return patient.formerFileNumbers.find((f) => normaliseIdentifier(f.number).includes(compact))?.number ?? null;
}

export interface CompletenessItem {
  category: DocumentCategory;
  label: string;
  present: boolean;
}

const COMPLETENESS_LABEL: Record<DocumentCategory, string> = {
  id_copy: "Identity document",
  medical_aid_card: "Medical aid card",
  consent_form: "Signed consent form",
  referral_letter: "Referral letter",
  correspondence: "Correspondence",
};

/** Which expected documents a patient file holds. Not every patient needs every category. */
export function documentCompleteness(patient: Patient, documents: readonly PatientDocument[]): CompletenessItem[] {
  return EXPECTED_CATEGORIES.filter((category) => {
    if (category === "medical_aid_card") return patient.payer.kind === "medical_aid";
    if (category === "referral_letter") return patient.referral.source !== "self";
    return true;
  }).map((category) => ({
    category,
    label: COMPLETENESS_LABEL[category],
    present: documents.some((d) => d.patientId === patient.id && d.category === category && d.status === "on_file"),
  }));
}

export function facilityCounts(patients: readonly Patient[]): Record<FacilityId, number> {
  const counts = Object.fromEntries(FACILITIES.map((f) => [f.id, 0])) as Record<FacilityId, number>;
  for (const p of patients) if (p.recordStatus === "active") counts[p.facilityId] += 1;
  return counts;
}

export function latestVersion(note: ClinicalNote) {
  return note.versions[note.versions.length - 1];
}
