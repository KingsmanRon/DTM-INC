import { describe, expect, it } from "vitest";
import { projectForRole, searchPatients, documentCompleteness, formerNumberMatch } from "@/app/demo/_interactive/state/selectors";
import { can, canViewScene, visibleScenes } from "@/app/demo/_interactive/state/permissions";
import { SEED_NOTES } from "@/app/demo/_interactive/fixtures/notes";
import { SEED_PATIENTS } from "@/app/demo/_interactive/fixtures/patients";
import { perform, start } from "./helpers";

describe("role-based access", () => {
  it("shows Clinical Notes to the doctor only", () => {
    expect(visibleScenes("doctor")).toContain("notes");
    expect(visibleScenes("staff")).not.toContain("notes");
    expect(visibleScenes("admin")).not.toContain("notes");
    expect(canViewScene("staff", "notes")).toBe(false);
  });

  it("keeps the audit log with the administrator, as in DTM", () => {
    expect(can("doctor", "audit.view")).toBe(false);
    expect(can("staff", "audit.view")).toBe(false);
    expect(can("admin", "audit.view")).toBe(true);
    expect(visibleScenes("doctor")).not.toContain("audit");
  });

  it("lets Reception register and track files but not read notes or the audit trail", () => {
    expect(can("staff", "patients.register")).toBe(true);
    expect(can("staff", "documents.attach")).toBe(true);
    expect(can("staff", "billing.manage")).toBe(true);
    expect(can("staff", "notes.view")).toBe(false);
    expect(can("staff", "audit.view")).toBe(false);
  });

  it("limits the Practice Administrator to practice-level administration and audit", () => {
    expect(visibleScenes("admin")).toEqual(["dashboard", "facilities", "audit"]);
    expect(can("admin", "patients.view")).toBe(false);
    expect(can("admin", "billing.view")).toBe(false);
  });
});

describe("least-privilege projection", () => {
  const state = perform(start(), "doctor", {
    type: "note/create",
    patientId: "p-0003",
    body: "Unique-live-note-text-4421",
  });
  const noteTexts = [
    ...SEED_NOTES.flatMap((n) => n.versions.map((v) => v.body)),
    "Unique-live-note-text-4421",
  ];

  it("gives the doctor the notes", () => {
    const model = projectForRole(state, "doctor");
    expect(model.notes.length).toBe(state.notes.length);
    expect(model.aggregates.clinical).not.toBeNull();
  });

  it.each(["staff", "admin"] as const)("removes every note, void reason and note count for %s", (role) => {
    const model = projectForRole(state, role);
    expect(model.notes).toEqual([]);
    expect(model.aggregates.clinical).toBeNull();
    const serialised = JSON.stringify(model);
    for (const text of noteTexts) expect(serialised).not.toContain(text);
    expect(serialised).not.toContain("Entered on the wrong patient file");
  });

  it("keeps patient demographics away from the Practice Administrator", () => {
    const model = projectForRole(state, "admin");
    expect(model.patients).toEqual([]);
    expect(model.documents).toEqual([]);
    expect(model.batches).toEqual([]);
    expect(model.aggregates.billing).toBeNull();
    const serialised = JSON.stringify(model);
    for (const p of SEED_PATIENTS) expect(serialised).not.toContain(p.surname);
    expect(model.aggregates.activePatients).toBe(11);
  });

  it("withholds the audit log from Reception and the doctor, and gives it to the administrator", () => {
    expect(projectForRole(state, "staff").audit).toEqual([]);
    expect(projectForRole(state, "staff").aggregates.auditEventCount).toBeNull();
    expect(projectForRole(state, "doctor").audit).toEqual([]);
    expect(projectForRole(state, "admin").audit.length).toBe(state.audit.length);
    const trail = projectForRole(state, "admin").audit;
    expect(trail[0]!.at >= trail[1]!.at).toBe(true);
  });
});

describe("clinical activity (doctor only)", () => {
  const state = perform(start(), "doctor", { type: "note/create", patientId: "p-0003", body: "Unique-activity-text-9917" });

  it("gives the doctor note actions for a patient, never note text", () => {
    const activity = projectForRole(state, "doctor").clinicalActivity;
    expect(activity.length).toBeGreaterThan(0);
    expect(activity.every((e) => e.category === "clinical")).toBe(true);
    expect(activity.filter((e) => e.subjectId === "p-0003").map((e) => e.action)).toEqual(["note.created"]);
    expect(JSON.stringify(activity)).not.toContain("Unique-activity-text-9917");
  });

  it.each(["staff", "admin"] as const)("gives %s none", (role) => {
    expect(projectForRole(state, role).clinicalActivity).toEqual([]);
  });
});

describe("patient search", () => {
  const find = (q: string) => searchPatients(SEED_PATIENTS, q).map((p) => p.id);

  it("finds by name in any order, case-insensitively", () => {
    expect(find("dube")).toEqual(["p-0004"]);
    expect(find("Sibusiso Dube")).toEqual(["p-0004"]);
    expect(find("van der merwe pieter")).toEqual(["p-0002"]);
  });

  it("finds by synthetic identifier regardless of spacing and punctuation", () => {
    expect(find("SYN-ID-10002")).toEqual(["p-0002"]);
    expect(find("syn id 10002")).toEqual(["p-0002"]);
    expect(find("SYN-PP-30001")).toEqual(["p-0009"]);
  });

  it("finds by full or partial file number", () => {
    expect(find("JHB-2026-000065")).toEqual(["p-0012"]);
    expect(find("jhb 2026 000065")).toEqual(["p-0012"]);
    expect(find("000065")).toEqual(["p-0012"]);
  });

  it("finds a patient by a retired file number, and says which one matched", () => {
    expect(find("NTH-2026-000106")).toEqual(["p-0009"]);
    const thabo = SEED_PATIENTS.find((p) => p.id === "p-0009")!;
    expect(formerNumberMatch(thabo, "NTH-2026-000106")).toBe("NTH-2026-000106");
    expect(formerNumberMatch(thabo, "JHB-2026-000066")).toBeNull();
    expect(formerNumberMatch(thabo, "Molefe")).toBeNull();
  });

  it("returns nothing for short or unknown queries", () => {
    expect(find("d")).toEqual([]);
    expect(find("Nobody Here")).toEqual([]);
  });
});

describe("document completeness", () => {
  it("only expects documents that apply to the patient", () => {
    const privatePatient = SEED_PATIENTS.find((p) => p.id === "p-0003")!;
    const items = documentCompleteness(privatePatient, []);
    expect(items.map((i) => i.category)).not.toContain("medical_aid_card");
    expect(items.map((i) => i.category)).not.toContain("referral_letter");
    const aidPatient = SEED_PATIENTS.find((p) => p.id === "p-0002")!;
    expect(documentCompleteness(aidPatient, []).map((i) => i.category)).toContain("referral_letter");
  });
});
