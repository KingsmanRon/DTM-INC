import { createInitialState } from "@/app/demo/_interactive/fixtures";
import { templateById, CATEGORY_LABEL } from "@/app/demo/_interactive/fixtures/documents";
import { FACILITIES, facilityById, formatFileNumber } from "@/app/demo/_interactive/fixtures/practice";
import type {
  AuditAction,
  BillingBatch,
  BillingItem,
  ClinicalNote,
  DemoState,
  FacilityId,
  OnboardingDraft,
  Patient,
  PatientAmendment,
  PatientDocument,
  Progress,
  Role,
} from "@/app/demo/_interactive/types";
import { makeAuditEvent } from "./audit";
import { derivePayerLabel } from "./billing";
import { nowIso, pad } from "./clock";
import { emptyDraft, findDuplicateByIdentity, validateAll, validateContactChanges, type ContactChanges } from "./onboarding";
import { ACTORS, can } from "./permissions";
import { formatMonth } from "@/app/demo/_interactive/kit/format";

export type MarkableProgress = Exclude<keyof Progress, "rolesSeen">;

export const MAX_NOTE_LENGTH = 2000;

/** Every action carries the simulated role performing it; the reducer re-checks permissions. */
export type DemoAction =
  | { type: "reset"; role: Role }
  | { type: "role/seen"; role: Role }
  | { type: "progress/mark"; role: Role; key: MarkableProgress }
  | { type: "draft/set"; role: Role; draft: OnboardingDraft }
  | { type: "registration/clear"; role: Role }
  | { type: "patient/register"; role: Role }
  | { type: "patient/amend"; role: Role; patientId: string; changes: ContactChanges }
  | { type: "patient/reassign"; role: Role; patientId: string; facilityId: FacilityId }
  | { type: "document/attach"; role: Role; patientId: string; templateId: string }
  | { type: "document/archive"; role: Role; documentId: string }
  | { type: "note/create"; role: Role; patientId: string; body: string }
  | { type: "note/save"; role: Role; noteId: string; body: string }
  | { type: "note/finalise"; role: Role; noteId: string }
  | { type: "note/amend"; role: Role; noteId: string; body: string; reason: string }
  | { type: "note/void"; role: Role; noteId: string; reason: string }
  | { type: "billing/add"; role: Role; facilityId: FacilityId; month: string; patientIds: string[] }
  | { type: "billing/remove"; role: Role; batchId: string; patientId: string }
  | { type: "billing/ready"; role: Role; batchId: string }
  | { type: "billing/handover"; role: Role; batchId: string }
  | { type: "billing/returned"; role: Role; batchId: string };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type ActionInput = DistributiveOmit<DemoAction, "role">;

function mark(state: DemoState, key: MarkableProgress): DemoState {
  return state.progress[key] ? state : { ...state, progress: { ...state.progress, [key]: true } };
}

/** Appends an audit event and advances the fictional clock by one tick. */
function record(
  state: DemoState,
  role: Role,
  at: string,
  action: AuditAction,
  target: string,
  summary: string,
): DemoState {
  const event = makeAuditEvent(state.audit[state.audit.length - 1], {
    id: `a-${pad(state.seq.audit, 4)}`,
    at,
    actorName: ACTORS[role].name,
    actorRole: role,
    action,
    target,
    subjectId: state.patients.find((p) => p.fileNumber === target)?.id,
    summary,
  });
  return {
    ...state,
    tick: state.tick + 1,
    seq: { ...state.seq, audit: state.seq.audit + 1 },
    audit: [...state.audit, event],
  };
}

function fullName(patient: Pick<Patient, "firstNames" | "surname">): string {
  return `${patient.firstNames} ${patient.surname}`;
}

function replaceNote(state: DemoState, note: ClinicalNote): DemoState {
  return { ...state, notes: state.notes.map((n) => (n.id === note.id ? note : n)) };
}

function replaceBatch(state: DemoState, batch: BillingBatch): DemoState {
  return { ...state, batches: state.batches.map((b) => (b.id === batch.id ? batch : b)) };
}

function register(state: DemoState, role: Role): DemoState {
  if (!can(role, "patients.register")) return state;
  const draft = state.draft;
  if (!validateAll(draft).valid) return state;
  const { facilityId } = draft.patient;
  if (!facilityId || !draft.payer.kind || !draft.referral.source) return state;

  const duplicate = findDuplicateByIdentity(state.patients, draft.patient.idType, draft.patient.idNumber);
  if (duplicate) {
    return mark({ ...state, registration: { status: "blocked", existingPatientId: duplicate.id } }, "duplicateBlocked");
  }

  const at = nowIso(state.tick);
  const p = draft.patient;
  const name = `${p.firstNames.trim()} ${p.surname.trim()}`;
  const idNumber = p.idNumber.trim().toUpperCase();
  const phone = p.phone.trim();
  const address = p.address.trim();
  const actor = ACTORS[role].name;

  const patient: Patient = {
    id: `p-${pad(state.seq.patient, 4)}`,
    fileNumber: formatFileNumber(facilityById(facilityId).prefix, state.fileSeq[facilityId]),
    formerFileNumbers: [],
    title: p.title,
    firstNames: p.firstNames.trim(),
    surname: p.surname.trim(),
    idType: p.idType,
    idNumber,
    dateOfBirth: p.dateOfBirth,
    phone,
    email: p.email.trim(),
    address,
    facilityId,
    recordStatus: "active",
    payer:
      draft.payer.kind === "medical_aid"
        ? {
            kind: "medical_aid",
            scheme: draft.payer.scheme,
            membershipNumber: draft.payer.membershipNumber.trim(),
            plan: draft.payer.plan.trim(),
          }
        : { kind: "private" },
    responsible: draft.responsible.sameAsPatient
      ? { sameAsPatient: true, name, relationship: "Self", idNumber, phone, address }
      : {
          sameAsPatient: false,
          name: draft.responsible.name.trim(),
          relationship: draft.responsible.relationship.trim(),
          idNumber: draft.responsible.idNumber.trim().toUpperCase(),
          phone: draft.responsible.phone.trim(),
          address: draft.responsible.address.trim(),
        },
    emergency: {
      name: draft.emergency.name.trim(),
      relationship: draft.emergency.relationship.trim(),
      phone: draft.emergency.phone.trim(),
      email: draft.emergency.email.trim(),
    },
    referral: {
      source: draft.referral.source,
      name: draft.referral.name.trim(),
      phone: draft.referral.phone.trim(),
      notes: draft.referral.notes.trim(),
    },
    dependants: draft.dependants.map((d) => ({ ...d })),
    consent: {
      agreed: true,
      signedName: draft.consent.signedName.trim(),
      wordingVersion: "Sample wording v1",
      capturedAt: at,
    },
    createdAt: at,
    amendments: [],
    assignments: [{ at, actor, facilityId, note: "Assigned at registration" }],
  };

  const next: DemoState = {
    ...state,
    seq: { ...state.seq, patient: state.seq.patient + 1 },
    fileSeq: { ...state.fileSeq, [facilityId]: state.fileSeq[facilityId] + 1 },
    patients: [...state.patients, patient],
    draft: emptyDraft(),
    registration: { status: "success", patientId: patient.id },
  };
  return mark(
    record(next, role, at, "patient.created", patient.fileNumber, `Patient registered at ${facilityById(facilityId).name} (${name})`),
    "registered",
  );
}

function amendPatient(state: DemoState, action: Extract<DemoAction, { type: "patient/amend" }>): DemoState {
  if (!can(action.role, "patients.amend")) return state;
  const patient = state.patients.find((p) => p.id === action.patientId);
  if (!patient || patient.recordStatus === "archived") return state;
  if (Object.keys(validateContactChanges(action.changes)).length > 0) return state;

  const at = nowIso(state.tick);
  const actor = ACTORS[action.role].name;
  const amendments: PatientAmendment[] = [];
  let updated: Patient = patient;

  const apply = (field: string, from: string, to: string | undefined, assign: (value: string) => Patient) => {
    const value = to?.trim();
    if (value === undefined || value === from) return;
    amendments.push({ at, actor, field, from: from || "(blank)", to: value || "(blank)" });
    updated = assign(value);
  };

  apply("Phone number", patient.phone, action.changes.phone, (v) => ({ ...updated, phone: v }));
  apply("Email address", patient.email, action.changes.email, (v) => ({ ...updated, email: v }));
  apply("Address", patient.address, action.changes.address, (v) => ({ ...updated, address: v }));
  if (patient.payer.kind === "medical_aid") {
    const payer = patient.payer;
    apply("Medical aid number", payer.membershipNumber, action.changes.membershipNumber, (v) => ({
      ...updated,
      payer: { ...payer, membershipNumber: v },
    }));
  }
  if (amendments.length === 0) return state;

  updated = { ...updated, amendments: [...updated.amendments, ...amendments] };
  const next: DemoState = { ...state, patients: state.patients.map((p) => (p.id === patient.id ? updated : p)) };
  const fields = amendments.map((a) => a.field.toLowerCase()).join(", ");
  return record(next, action.role, at, "patient.amended", patient.fileNumber, `Details amended: ${fields}`);
}

/**
 * Moving a patient to another hospital mirrors DTM's real workflow: a NEW file
 * number is issued under the new hospital's prefix, the old number is retired
 * (never reissued, still searchable), and billing rows that were never exported
 * for the old hospital are removed because they snapshot a number and hospital
 * that are no longer right.
 */
function reassign(state: DemoState, action: Extract<DemoAction, { type: "patient/reassign" }>): DemoState {
  if (!can(action.role, "facilities.reassign")) return state;
  const patient = state.patients.find((p) => p.id === action.patientId);
  if (!patient || patient.recordStatus === "archived" || patient.facilityId === action.facilityId) return state;
  if (!FACILITIES.some((f) => f.id === action.facilityId)) return state;

  const at = nowIso(state.tick);
  const target = facilityById(action.facilityId);
  const from = facilityById(patient.facilityId).name;
  const newNumber = formatFileNumber(target.prefix, state.fileSeq[action.facilityId]);
  const oldNumber = patient.fileNumber;

  const updated: Patient = {
    ...patient,
    facilityId: action.facilityId,
    fileNumber: newNumber,
    formerFileNumbers: [...patient.formerFileNumbers, { number: oldNumber, facilityId: patient.facilityId, retiredAt: at }],
    assignments: [
      ...patient.assignments,
      {
        at,
        actor: ACTORS[action.role].name,
        facilityId: action.facilityId,
        note: `Moved from ${from} to ${target.name}. New file number ${newNumber}; ${oldNumber} retired`,
      },
    ],
  };

  let removed = 0;
  const batches = state.batches.map((batch) => {
    if (batch.facilityId !== patient.facilityId || batch.status !== "preparing") return batch;
    const items = batch.items.filter((item) => item.patientId !== patient.id);
    removed += batch.items.length - items.length;
    return items.length === batch.items.length ? batch : { ...batch, items };
  });

  const next: DemoState = {
    ...state,
    patients: state.patients.map((p) => (p.id === patient.id ? updated : p)),
    fileSeq: { ...state.fileSeq, [action.facilityId]: state.fileSeq[action.facilityId] + 1 },
    batches,
  };
  const billing = removed > 0 ? `; ${removed} pending billing ${removed === 1 ? "row" : "rows"} for ${from} removed` : "";
  return mark(
    record(
      next,
      action.role,
      at,
      "patient.facility_reassigned",
      newNumber,
      `File moved from ${from} to ${target.name}. New file number ${newNumber}; ${oldNumber} is retired but stays searchable${billing}`,
    ),
    "facilityReassigned",
  );
}

function attachDocument(state: DemoState, action: Extract<DemoAction, { type: "document/attach" }>): DemoState {
  if (!can(action.role, "documents.attach")) return state;
  const patient = state.patients.find((p) => p.id === action.patientId);
  const template = templateById(action.templateId);
  if (!patient || !template || patient.recordStatus === "archived") return state;
  const alreadyOnFile = state.documents.some(
    (d) => d.patientId === patient.id && d.templateId === template.id && d.status === "on_file",
  );
  if (alreadyOnFile) return state;

  const at = nowIso(state.tick);
  const actor = ACTORS[action.role].name;
  const document: PatientDocument = {
    id: `d-${pad(state.seq.document, 4)}`,
    patientId: patient.id,
    templateId: template.id,
    title: template.title,
    category: template.category,
    fileName: template.fileName,
    sizeLabel: template.sizeLabel,
    status: "on_file",
    attachedAt: at,
    attachedBy: actor,
    history: [{ at, actor, action: "attached", detail: `${template.title} attached to the patient file` }],
  };
  const next: DemoState = {
    ...state,
    seq: { ...state.seq, document: state.seq.document + 1 },
    documents: [...state.documents, document],
  };
  return mark(
    record(next, action.role, at, "document.attached", patient.fileNumber, `${CATEGORY_LABEL[template.category]} attached (sample document)`),
    "documentAttached",
  );
}

function archiveDocument(state: DemoState, action: Extract<DemoAction, { type: "document/archive" }>): DemoState {
  if (!can(action.role, "documents.archive")) return state;
  const document = state.documents.find((d) => d.id === action.documentId);
  if (!document || document.status !== "on_file") return state;
  const patient = state.patients.find((p) => p.id === document.patientId);
  if (!patient) return state;

  const at = nowIso(state.tick);
  const actor = ACTORS[action.role].name;
  const updated: PatientDocument = {
    ...document,
    status: "archived",
    history: [...document.history, { at, actor, action: "archived", detail: "Archived. Kept in the document history, not deleted." }],
  };
  const next: DemoState = { ...state, documents: state.documents.map((d) => (d.id === document.id ? updated : d)) };
  return record(next, action.role, at, "document.archived", patient.fileNumber, `${CATEGORY_LABEL[document.category]} archived`);
}

function cleanBody(body: string): string | null {
  const trimmed = body.trim();
  return trimmed && trimmed.length <= MAX_NOTE_LENGTH ? trimmed : null;
}

function createNote(state: DemoState, action: Extract<DemoAction, { type: "note/create" }>): DemoState {
  if (!can(action.role, "notes.write")) return state;
  const patient = state.patients.find((p) => p.id === action.patientId);
  const body = cleanBody(action.body);
  if (!patient || !body || patient.recordStatus === "archived") return state;

  const at = nowIso(state.tick);
  const id = `n-${pad(state.seq.note, 4)}`;
  const note: ClinicalNote = {
    id,
    patientId: patient.id,
    status: "draft",
    createdAt: at,
    voided: null,
    versions: [
      { version: 1, kind: "original", body, author: ACTORS[action.role].name, savedAt: at, finalisedAt: null, reason: "" },
    ],
  };
  const next: DemoState = { ...state, seq: { ...state.seq, note: state.seq.note + 1 }, notes: [...state.notes, note] };
  return mark(
    record(next, action.role, at, "note.created", patient.fileNumber, `Clinical note ${id.toUpperCase()} created (draft)`),
    "noteCreated",
  );
}

function noteTarget(state: DemoState, noteId: string): { note: ClinicalNote; patient: Patient } | null {
  const note = state.notes.find((n) => n.id === noteId);
  const patient = note && state.patients.find((p) => p.id === note.patientId);
  return note && patient ? { note, patient } : null;
}

function saveNote(state: DemoState, action: Extract<DemoAction, { type: "note/save" }>): DemoState {
  if (!can(action.role, "notes.write")) return state;
  const target = noteTarget(state, action.noteId);
  const body = cleanBody(action.body);
  if (!target || !body || target.note.status !== "draft") return state;

  const at = nowIso(state.tick);
  const [first, ...rest] = target.note.versions;
  if (!first) return state;
  const note: ClinicalNote = { ...target.note, versions: [{ ...first, body, savedAt: at }, ...rest] };
  return record(
    replaceNote(state, note),
    action.role,
    at,
    "note.saved",
    target.patient.fileNumber,
    `Clinical note ${note.id.toUpperCase()} draft saved`,
  );
}

function finaliseNote(state: DemoState, action: Extract<DemoAction, { type: "note/finalise" }>): DemoState {
  if (!can(action.role, "notes.write")) return state;
  const target = noteTarget(state, action.noteId);
  if (!target || target.note.status !== "draft") return state;

  const at = nowIso(state.tick);
  const versions = target.note.versions.map((v, i, all) => (i === all.length - 1 ? { ...v, finalisedAt: at } : v));
  const note: ClinicalNote = { ...target.note, status: "finalised", versions };
  const latest = versions[versions.length - 1];
  return mark(
    record(
      replaceNote(state, note),
      action.role,
      at,
      "note.finalised",
      target.patient.fileNumber,
      `Clinical note ${note.id.toUpperCase()} finalised (version ${latest?.version ?? 1})`,
    ),
    "noteFinalised",
  );
}

function amendNote(state: DemoState, action: Extract<DemoAction, { type: "note/amend" }>): DemoState {
  if (!can(action.role, "notes.write")) return state;
  const target = noteTarget(state, action.noteId);
  const body = cleanBody(action.body);
  const reason = action.reason.trim();
  if (!target || !body || !reason || target.note.status !== "finalised") return state;
  const current = target.note.versions[target.note.versions.length - 1];
  if (!current || current.body === body) return state;

  const at = nowIso(state.tick);
  const version = current.version + 1;
  const note: ClinicalNote = {
    ...target.note,
    versions: [
      ...target.note.versions,
      { version, kind: "amendment", body, author: ACTORS[action.role].name, savedAt: at, finalisedAt: at, reason },
    ],
  };
  return mark(
    record(
      replaceNote(state, note),
      action.role,
      at,
      "note.amended",
      target.patient.fileNumber,
      `Clinical note ${note.id.toUpperCase()} amended (version ${version})`,
    ),
    "noteAmended",
  );
}

function voidNote(state: DemoState, action: Extract<DemoAction, { type: "note/void" }>): DemoState {
  if (!can(action.role, "notes.write")) return state;
  const target = noteTarget(state, action.noteId);
  const reason = action.reason.trim();
  if (!target || !reason || target.note.status === "voided") return state;

  const at = nowIso(state.tick);
  const note: ClinicalNote = {
    ...target.note,
    status: "voided",
    voided: { at, by: ACTORS[action.role].name, reason },
  };
  return mark(
    record(
      replaceNote(state, note),
      action.role,
      at,
      "note.voided",
      target.patient.fileNumber,
      `Clinical note ${note.id.toUpperCase()} voided (reason recorded)`,
    ),
    "noteVoided",
  );
}

function addToBatch(state: DemoState, action: Extract<DemoAction, { type: "billing/add" }>): DemoState {
  if (!can(action.role, "billing.manage")) return state;
  if (!FACILITIES.some((f) => f.id === action.facilityId) || !/^\d{4}-\d{2}$/.test(action.month)) return state;

  let working = state;
  const at = nowIso(state.tick);
  let batch = state.batches.find((b) => b.facilityId === action.facilityId && b.month === action.month);
  if (batch && batch.status !== "preparing") return state;

  const existing = new Set(batch?.items.map((i) => i.patientId) ?? []);
  const items: BillingItem[] = [];
  for (const patientId of action.patientIds) {
    const patient = state.patients.find((p) => p.id === patientId);
    if (!patient || patient.recordStatus !== "active" || patient.facilityId !== action.facilityId) continue;
    if (existing.has(patient.id)) continue;
    existing.add(patient.id);
    const payer = derivePayerLabel(patient.payer);
    items.push({
      patientId: patient.id,
      fileNumber: patient.fileNumber,
      patientName: fullName(patient),
      payerKind: payer.kind,
      payerLabel: payer.label,
      addedAt: at,
    });
  }
  if (items.length === 0) return state;

  const facilityName = facilityById(action.facilityId).name;
  const monthLabel = formatMonth(action.month);
  if (!batch) {
    batch = {
      id: `b-${pad(state.seq.batch, 4)}`,
      facilityId: action.facilityId,
      month: action.month,
      status: "preparing",
      items: [],
      createdAt: at,
      readyAt: null,
      outgoingAt: null,
      returnedAt: null,
      recipient: "External billing provider (sample)",
    };
    working = { ...working, seq: { ...working.seq, batch: working.seq.batch + 1 }, batches: [...working.batches, batch] };
    working = record(working, action.role, at, "billing.batch_prepared", `Batch ${batch.id}`, `${monthLabel} file batch prepared for ${facilityName}`);
  }
  const filled: BillingBatch = { ...batch, items: [...batch.items, ...items] };
  working = replaceBatch(working, filled);
  const count = items.length;
  return mark(
    record(
      working,
      action.role,
      nowIso(working.tick),
      "billing.files_added",
      `Batch ${filled.id}`,
      `${count} ${count === 1 ? "file" : "files"} added to the ${monthLabel} batch`,
    ),
    "billingStaged",
  );
}

function removeFromBatch(state: DemoState, action: Extract<DemoAction, { type: "billing/remove" }>): DemoState {
  if (!can(action.role, "billing.manage")) return state;
  const batch = state.batches.find((b) => b.id === action.batchId);
  if (!batch || batch.status !== "preparing") return state;
  const items = batch.items.filter((i) => i.patientId !== action.patientId);
  if (items.length === batch.items.length) return state;
  return replaceBatch(state, { ...batch, items });
}

function advanceBatch(
  state: DemoState,
  role: Role,
  batchId: string,
  from: BillingBatch["status"],
  to: BillingBatch["status"],
): DemoState {
  if (!can(role, "billing.manage")) return state;
  const batch = state.batches.find((b) => b.id === batchId);
  if (!batch || batch.status !== from) return state;
  if (to === "ready" && batch.items.length === 0) return state;

  const at = nowIso(state.tick);
  const updated: BillingBatch = {
    ...batch,
    status: to,
    readyAt: to === "ready" ? at : batch.readyAt,
    outgoingAt: to === "handed_over" ? at : batch.outgoingAt,
    returnedAt: to === "returned" ? at : batch.returnedAt,
  };
  const monthLabel = formatMonth(batch.month);
  const facilityName = facilityById(batch.facilityId).name;
  const count = batch.items.length;
  const files = `${count} ${count === 1 ? "file" : "files"}`;
  const next = replaceBatch(state, updated);
  if (to === "ready") {
    return mark(
      record(next, role, at, "billing.batch_ready", `Batch ${batch.id}`, `${monthLabel} batch for ${facilityName} marked ready for external billing-provider handover (${files})`),
      "billingReady",
    );
  }
  if (to === "handed_over") {
    return record(next, role, at, "billing.handover_recorded", `Batch ${batch.id}`, `${monthLabel} batch for ${facilityName} handed over to the external billing provider (${files})`);
  }
  return record(next, role, at, "billing.batch_returned", `Batch ${batch.id}`, `${monthLabel} batch for ${facilityName} returned (${files})`);
}

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "reset": {
      const fresh = createInitialState();
      return { ...fresh, progress: { ...fresh.progress, rolesSeen: [action.role] } };
    }
    case "role/seen":
      return state.progress.rolesSeen.includes(action.role)
        ? state
        : { ...state, progress: { ...state.progress, rolesSeen: [...state.progress.rolesSeen, action.role] } };
    case "progress/mark":
      return mark(state, action.key);
    case "draft/set":
      return can(action.role, "patients.register") ? { ...state, draft: action.draft } : state;
    case "registration/clear":
      return state.registration.status === "idle" ? state : { ...state, registration: { status: "idle" } };
    case "patient/register":
      return register(state, action.role);
    case "patient/amend":
      return amendPatient(state, action);
    case "patient/reassign":
      return reassign(state, action);
    case "document/attach":
      return attachDocument(state, action);
    case "document/archive":
      return archiveDocument(state, action);
    case "note/create":
      return createNote(state, action);
    case "note/save":
      return saveNote(state, action);
    case "note/finalise":
      return finaliseNote(state, action);
    case "note/amend":
      return amendNote(state, action);
    case "note/void":
      return voidNote(state, action);
    case "billing/add":
      return addToBatch(state, action);
    case "billing/remove":
      return removeFromBatch(state, action);
    case "billing/ready":
      return advanceBatch(state, action.role, action.batchId, "preparing", "ready");
    case "billing/handover":
      return advanceBatch(state, action.role, action.batchId, "ready", "handed_over");
    case "billing/returned":
      return advanceBatch(state, action.role, action.batchId, "handed_over", "returned");
    default:
      return state;
  }
}
