import { describe, expect, it } from "vitest";
import { createInitialState } from "@/app/demo/_interactive/fixtures";
import { sampleDraft } from "@/app/demo/_interactive/state/onboarding";
import { buildHandoverCsv, CSV_NOTICE } from "@/app/demo/_interactive/state/billing";
import { perform, registerSample, start } from "./helpers";

describe("initial state", () => {
  it("is a seeded, deterministic synthetic register", () => {
    const a = createInitialState();
    const b = createInitialState();
    expect(a).toEqual(b);
    expect(a.patients).toHaveLength(12);
    expect(a.patients.filter((p) => p.recordStatus === "archived")).toHaveLength(1);
    expect(new Set(a.patients.map((p) => p.fileNumber)).size).toBe(12);
    expect(new Set(a.patients.map((p) => p.facilityId))).toEqual(new Set(["nth", "jhb"]));
  });

  it("does not let one session mutate the seed for the next", () => {
    const first = registerSample(start());
    expect(first.patients).toHaveLength(13);
    expect(createInitialState().patients).toHaveLength(12);
  });
});

describe("workflow A/B: duplicate prevention and onboarding", () => {
  it("registers a new fictional patient with the next file number and an audit entry", () => {
    const state = registerSample(start());
    expect(state.registration.status).toBe("success");
    const created = state.patients[state.patients.length - 1];
    expect(created?.fileNumber).toBe("NTH-2026-000108");
    expect(created?.surname).toBe("Maseko");
    expect(created?.dependants).toHaveLength(1);
    expect(state.draft.patient.firstNames).toBe("");
    const event = state.audit[state.audit.length - 1];
    expect(event?.action).toBe("patient.created");
    expect(event?.target).toBe("NTH-2026-000108");
    expect(state.progress.registered).toBe(true);
  });

  it("issues sequential file numbers", () => {
    let state = registerSample(start());
    const second = { ...sampleDraft(), patient: { ...sampleDraft().patient, idNumber: "SYN-ID-20002", surname: "Zulu" } };
    state = perform(state, "staff", { type: "draft/set", draft: second }, { type: "patient/register" });
    expect(state.patients[state.patients.length - 1]?.fileNumber).toBe("NTH-2026-000109");
  });

  it("blocks a duplicate identifier within the practice and creates no record", () => {
    const duplicate = { ...sampleDraft(), patient: { ...sampleDraft().patient, idNumber: "syn-id-10002" } };
    const before = start();
    const state = perform(before, "staff", { type: "draft/set", draft: duplicate }, { type: "patient/register" });
    expect(state.registration).toEqual({ status: "blocked", existingPatientId: "p-0002" });
    expect(state.patients).toHaveLength(before.patients.length);
    expect(state.audit).toHaveLength(before.audit.length);
    expect(state.progress.duplicateBlocked).toBe(true);
  });

  it("refuses an incomplete draft", () => {
    const state = perform(start(), "staff", { type: "patient/register" });
    expect(state.patients).toHaveLength(12);
    expect(state.registration.status).toBe("idle");
  });

  it("does not let the Practice Administrator register patients", () => {
    const state = perform(start(), "admin", { type: "draft/set", draft: sampleDraft() }, { type: "patient/register" });
    expect(state.patients).toHaveLength(12);
  });
});

describe("workflow C: documents", () => {
  it("attaches a bundled sample document to the correct patient only", () => {
    const state = perform(start(), "staff", { type: "document/attach", patientId: "p-0003", templateId: "tpl-referral" });
    const added = state.documents.filter((d) => d.patientId === "p-0003" && d.templateId === "tpl-referral");
    expect(added).toHaveLength(1);
    expect(added[0]?.history[0]?.action).toBe("attached");
    expect(state.documents.filter((d) => d.patientId === "p-0001")).toHaveLength(3);
    expect(state.audit[state.audit.length - 1]?.action).toBe("document.attached");
    expect(state.progress.documentAttached).toBe(true);
  });

  it("does not attach the same sample twice, and rejects unknown templates", () => {
    let state = perform(start(), "staff", { type: "document/attach", patientId: "p-0003", templateId: "tpl-referral" });
    const count = state.documents.length;
    state = perform(state, "staff", { type: "document/attach", patientId: "p-0003", templateId: "tpl-referral" });
    state = perform(state, "staff", { type: "document/attach", patientId: "p-0003", templateId: "uploaded-from-visitor.pdf" });
    expect(state.documents).toHaveLength(count);
  });

  it("archives rather than deletes, keeping the history", () => {
    const state = perform(start(), "staff", { type: "document/archive", documentId: "d-0001" });
    const doc = state.documents.find((d) => d.id === "d-0001");
    expect(doc?.status).toBe("archived");
    expect(doc?.history.map((h) => h.action)).toEqual(["attached", "verified", "archived"]);
  });
});

describe("workflow D: clinical notes", () => {
  const body = "Fictional review note for testing.";

  it("lets a doctor create, save, finalise and amend while preserving the original", () => {
    let state = perform(start(), "doctor", { type: "note/create", patientId: "p-0003", body });
    const note = state.notes[state.notes.length - 1];
    expect(note?.status).toBe("draft");
    state = perform(state, "doctor", { type: "note/save", noteId: note!.id, body: `${body} Edited.` });
    state = perform(state, "doctor", { type: "note/finalise", noteId: note!.id });
    expect(state.notes.find((n) => n.id === note!.id)?.status).toBe("finalised");
    state = perform(state, "doctor", { type: "note/amend", noteId: note!.id, body: "Amended wording.", reason: "Corrected a detail." });
    const final = state.notes.find((n) => n.id === note!.id)!;
    expect(final.versions).toHaveLength(2);
    expect(final.versions[0]).toMatchObject({ version: 1, kind: "original", body: `${body} Edited.` });
    expect(final.versions[1]).toMatchObject({ version: 2, kind: "amendment", reason: "Corrected a detail." });
    expect(final.status).toBe("finalised");

    const actions = state.audit.slice(-4).map((e) => e.action);
    expect(actions).toEqual(["note.created", "note.saved", "note.finalised", "note.amended"]);
  });

  it("requires a reason to amend or void, and a changed body to amend", () => {
    let state = perform(start(), "doctor", { type: "note/amend", noteId: "n-0001", body: "New wording.", reason: "  " });
    expect(state.notes.find((n) => n.id === "n-0001")?.versions).toHaveLength(2);
    state = perform(state, "doctor", { type: "note/amend", noteId: "n-0003", body: state.notes.find((n) => n.id === "n-0003")!.versions[0]!.body, reason: "Same text" });
    expect(state.notes.find((n) => n.id === "n-0003")?.versions).toHaveLength(1);
    state = perform(state, "doctor", { type: "note/void", noteId: "n-0003", reason: "" });
    expect(state.notes.find((n) => n.id === "n-0003")?.status).toBe("finalised");
  });

  it("voids with a reason and keeps the full history readable", () => {
    const state = perform(start(), "doctor", { type: "note/void", noteId: "n-0001", reason: "Duplicate entry." });
    const note = state.notes.find((n) => n.id === "n-0001")!;
    expect(note.status).toBe("voided");
    expect(note.voided?.reason).toBe("Duplicate entry.");
    expect(note.versions).toHaveLength(2);
    expect(state.audit[state.audit.length - 1]?.action).toBe("note.voided");
  });

  it("will not amend a draft or modify a voided note", () => {
    let state = perform(start(), "doctor", { type: "note/amend", noteId: "n-0002", body: "x", reason: "y" });
    expect(state.notes.find((n) => n.id === "n-0002")?.versions).toHaveLength(1);
    state = perform(state, "doctor", { type: "note/finalise", noteId: "n-0004" });
    expect(state.notes.find((n) => n.id === "n-0004")?.status).toBe("voided");
  });

  it.each(["staff", "admin"] as const)("rejects every note write from the %s role", (role) => {
    const before = start();
    const after = perform(
      before,
      role,
      { type: "note/create", patientId: "p-0003", body },
      { type: "note/save", noteId: "n-0002", body: "tamper" },
      { type: "note/finalise", noteId: "n-0002" },
      { type: "note/amend", noteId: "n-0001", body: "tamper", reason: "tamper" },
      { type: "note/void", noteId: "n-0001", reason: "tamper" },
    );
    expect(after.notes).toEqual(before.notes);
    expect(after.audit).toEqual(before.audit);
  });
});

describe("workflow F: hospitals and file numbers", () => {
  it("issues a new file number under the new hospital's prefix and retires the old one", () => {
    const state = perform(start(), "staff", { type: "patient/reassign", patientId: "p-0001", facilityId: "jhb" });
    const patient = state.patients.find((p) => p.id === "p-0001")!;
    expect(patient.facilityId).toBe("jhb");
    expect(patient.fileNumber).toBe("JHB-2026-000067");
    expect(patient.formerFileNumbers.map((f) => f.number)).toEqual(["NTH-2026-000102"]);
    expect(patient.assignments).toHaveLength(2);
    expect(state.fileSeq.jhb).toBe(68);
    const event = state.audit[state.audit.length - 1]!;
    expect(event).toMatchObject({ action: "patient.facility_reassigned", category: "facility", target: "JHB-2026-000067", subjectId: "p-0001" });
    expect(event.summary).toContain("NTH-2026-000102 is retired but stays searchable");
  });

  it("never reuses a retired number: moving back issues yet another new number", () => {
    let state = perform(start(), "staff", { type: "patient/reassign", patientId: "p-0001", facilityId: "jhb" });
    state = perform(state, "staff", { type: "patient/reassign", patientId: "p-0001", facilityId: "nth" });
    const patient = state.patients.find((p) => p.id === "p-0001")!;
    expect(patient.fileNumber).toBe("NTH-2026-000108");
    expect(patient.fileNumber).not.toBe("NTH-2026-000102");
    expect(patient.formerFileNumbers.map((f) => f.number)).toEqual(["NTH-2026-000102", "JHB-2026-000067"]);
  });

  it("removes unexported billing rows for the old hospital, and leaves locked batches alone", () => {
    let state = perform(start(), "staff", { type: "billing/add", facilityId: "nth", month: "2026-10", patientIds: ["p-0001", "p-0003"] });
    state = perform(state, "staff", { type: "patient/reassign", patientId: "p-0001", facilityId: "jhb" });
    const pending = state.batches.find((b) => b.facilityId === "nth" && b.month === "2026-10")!;
    expect(pending.items.map((i) => i.patientId)).toEqual(["p-0003"]);
    expect(state.audit[state.audit.length - 1]?.summary).toContain("1 pending billing row for Northfield Demo Hospital removed");
    // The returned September batch is disclosure history and is never edited.
    expect(state.batches.find((b) => b.id === "b-0001")?.items.map((i) => i.patientId)).toContain("p-0001");
  });

  it("ignores no-op moves, archived patients and the administrator", () => {
    const base = start();
    let state = perform(base, "staff", { type: "patient/reassign", patientId: "p-0001", facilityId: "nth" });
    state = perform(state, "staff", { type: "patient/reassign", patientId: "p-0008", facilityId: "jhb" });
    state = perform(state, "admin", { type: "patient/reassign", patientId: "p-0001", facilityId: "jhb" });
    expect(state.patients).toEqual(base.patients);
  });

  it("seeds a patient who was already moved, with a retired number", () => {
    const thabo = start().patients.find((p) => p.id === "p-0009")!;
    expect(thabo.fileNumber).toBe("JHB-2026-000066");
    expect(thabo.formerFileNumbers[0]?.number).toBe("NTH-2026-000106");
  });

  it("numbers patients per hospital prefix", () => {
    let state = registerSample(start());
    const second = { ...sampleDraft(), patient: { ...sampleDraft().patient, idNumber: "SYN-ID-20002", surname: "Zulu", facilityId: "jhb" as const } };
    state = perform(state, "staff", { type: "draft/set", draft: second }, { type: "patient/register" });
    expect(state.patients[state.patients.length - 1]?.fileNumber).toBe("JHB-2026-000067");
    expect(state.patients[state.patients.length - 2]?.fileNumber).toBe("NTH-2026-000108");
  });
});

describe("patient details amendment", () => {
  it("records each changed field and logs field names only", () => {
    const state = perform(start(), "staff", {
      type: "patient/amend",
      patientId: "p-0001",
      changes: { phone: "000 000 0999", address: "1 New Street, Demoville, 0000" },
    });
    const patient = state.patients.find((p) => p.id === "p-0001")!;
    expect(patient.phone).toBe("000 000 0999");
    expect(patient.amendments.map((a) => a.field)).toEqual(["Phone number", "Address"]);
    const event = state.audit[state.audit.length - 1]!;
    expect(event.summary).toBe("Details amended: phone number, address");
    expect(event.summary).not.toContain("000 000 0999");
  });

  it("rejects invalid values and unchanged values", () => {
    const base = start();
    const state = perform(
      base,
      "staff",
      { type: "patient/amend", patientId: "p-0001", changes: { phone: "abc" } },
      { type: "patient/amend", patientId: "p-0001", changes: { phone: base.patients[0]!.phone } },
    );
    expect(state.patients).toEqual(base.patients);
    expect(state.audit).toEqual(base.audit);
  });
});

describe("workflow G: Billing File Tracking", () => {
  it("stages active patients at the chosen location into one monthly batch", () => {
    const state = perform(start(), "staff", {
      type: "billing/add",
      facilityId: "nth",
      month: "2026-10",
      // p-0008 is archived and p-0004 is at the other location: both are skipped.
      patientIds: ["p-0001", "p-0003", "p-0006", "p-0008", "p-0004"],
    });
    const batch = state.batches.find((b) => b.facilityId === "nth" && b.month === "2026-10")!;
    expect(batch.status).toBe("preparing");
    expect(batch.items.map((i) => i.patientId)).toEqual(["p-0001", "p-0003", "p-0006"]);
    expect(batch.items.find((i) => i.patientId === "p-0003")).toMatchObject({ payerKind: "cash", payerLabel: "CASH" });
    expect(batch.items.find((i) => i.patientId === "p-0006")).toMatchObject({ payerKind: "missing", payerLabel: "" });
    expect(batch.items.find((i) => i.patientId === "p-0001")).toMatchObject({ payerKind: "member", payerLabel: "DHS-10001-A" });
    const actions = state.audit.slice(-2).map((e) => e.action);
    expect(actions).toEqual(["billing.batch_prepared", "billing.files_added"]);
  });

  it("does not duplicate files when staged again", () => {
    let state = perform(start(), "staff", { type: "billing/add", facilityId: "nth", month: "2026-10", patientIds: ["p-0001"] });
    const auditCount = state.audit.length;
    state = perform(state, "staff", { type: "billing/add", facilityId: "nth", month: "2026-10", patientIds: ["p-0001"] });
    expect(state.batches.find((b) => b.facilityId === "nth" && b.month === "2026-10")?.items).toHaveLength(1);
    expect(state.audit).toHaveLength(auditCount);
  });

  it("moves a batch through ready, handed over and returned in order only", () => {
    let state = perform(start(), "staff", { type: "billing/add", facilityId: "nth", month: "2026-10", patientIds: ["p-0001"] });
    const id = state.batches.find((b) => b.facilityId === "nth" && b.month === "2026-10")!.id;
    state = perform(state, "staff", { type: "billing/handover", batchId: id });
    expect(state.batches.find((b) => b.id === id)?.status).toBe("preparing");
    state = perform(state, "staff", { type: "billing/ready", batchId: id });
    expect(state.batches.find((b) => b.id === id)?.status).toBe("ready");
    state = perform(state, "staff", { type: "billing/add", facilityId: "nth", month: "2026-10", patientIds: ["p-0003"] });
    expect(state.batches.find((b) => b.id === id)?.items).toHaveLength(1);
    state = perform(state, "staff", { type: "billing/handover", batchId: id });
    expect(state.batches.find((b) => b.id === id)).toMatchObject({ status: "handed_over" });
    expect(state.batches.find((b) => b.id === id)?.outgoingAt).not.toBeNull();
    state = perform(state, "staff", { type: "billing/returned", batchId: id });
    expect(state.batches.find((b) => b.id === id)?.status).toBe("returned");
  });

  it("will not mark an empty batch ready", () => {
    const state = perform(start(), "staff", { type: "billing/remove", batchId: "b-0003", patientId: "p-0009" }, { type: "billing/remove", batchId: "b-0003", patientId: "p-0012" });
    expect(state.batches.find((b) => b.id === "b-0003")?.items).toHaveLength(0);
    const after = perform(state, "staff", { type: "billing/ready", batchId: "b-0003" });
    expect(after.batches.find((b) => b.id === "b-0003")?.status).toBe("preparing");
  });

  it("is unavailable to the Practice Administrator", () => {
    const base = start();
    const state = perform(base, "admin", { type: "billing/add", facilityId: "nth", month: "2026-10", patientIds: ["p-0001"] }, { type: "billing/ready", batchId: "b-0003" });
    expect(state.batches).toEqual(base.batches);
  });

  it("exports a clearly synthetic file-handover list, not a claim", () => {
    const batch = start().batches.find((b) => b.id === "b-0003")!;
    const csv = buildHandoverCsv(batch);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(CSV_NOTICE);
    expect(CSV_NOTICE).toMatch(/SYNTHETIC/);
    expect(lines[1]).toContain("File number");
    expect(lines).toHaveLength(2 + batch.items.length);
    expect(csv).toContain("JHB-2026-000066");
    expect(csv.toLowerCase()).not.toMatch(/tariff|invoice amount|claim number|remittance/);
  });
});

describe("workflow H: audit trail", () => {
  it("records every simulated action with a fictional actor and timestamp, oldest first", () => {
    let state = registerSample(start());
    state = perform(state, "doctor", { type: "note/create", patientId: "p-0003", body: "Fictional." });
    const live = state.audit.slice(14);
    expect(live.map((e) => e.action)).toEqual(["patient.created", "note.created"]);
    expect(live[0]?.at).toBe("2026-10-28T09:00:00+02:00");
    expect(live[1]?.at).toBe("2026-10-28T09:03:00+02:00");
    expect(live[0]?.actorName).toBe("Lindiwe Sample (Reception)");
    expect(live[1]?.actorName).toBe("Dr Sipho Example");
  });

  it("never writes clinical content or entered values into audit summaries", () => {
    const state = perform(start(), "doctor", { type: "note/create", patientId: "p-0003", body: "Distinctive-clinical-phrase-7781" });
    expect(JSON.stringify(state.audit)).not.toContain("Distinctive-clinical-phrase-7781");
  });
});

describe("reset", () => {
  it("returns the demo to the original synthetic dataset", () => {
    let state = registerSample(start());
    state = perform(state, "doctor", { type: "note/create", patientId: "p-0003", body: "Fictional." });
    state = perform(state, "staff", { type: "patient/reassign", patientId: "p-0001", facilityId: "jhb" });
    state = perform(state, "staff", { type: "reset" });
    expect({ ...state, progress: { ...state.progress, rolesSeen: [] } }).toEqual(createInitialState());
    expect(state.progress.rolesSeen).toEqual(["staff"]);
  });
});
