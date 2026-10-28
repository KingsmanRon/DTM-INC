import type { Role, SceneId } from "@/app/demo/_interactive/types";

/**
 * Capability matrix for the simulated roles.
 *
 * This is an illustration of the access model, not an authorisation system.
 * In the production product, access is enforced separately in the application,
 * in the API and in the database. Changing a screen never grants access.
 *
 * The matrix mirrors how DTM works today: doctor and staff use New patient,
 * Billing and the patient file (only the doctor sees clinical notes); the
 * administrator manages users, settings and the audit log, and has no
 * ordinary patient, clinical or billing access.
 */
export type Capability =
  | "dashboard.view"
  | "patients.view"
  | "patients.register"
  | "patients.amend"
  | "documents.view"
  | "documents.attach"
  | "documents.archive"
  | "notes.view"
  | "notes.write"
  | "facilities.view"
  | "facilities.patientList"
  | "facilities.reassign"
  | "billing.view"
  | "billing.manage"
  | "audit.view"
  | "users.view";

const DOCTOR: ReadonlySet<Capability> = new Set<Capability>([
  "dashboard.view",
  "patients.view",
  "patients.register",
  "patients.amend",
  "documents.view",
  "documents.attach",
  "documents.archive",
  "notes.view",
  "notes.write",
  "facilities.view",
  "facilities.patientList",
  "facilities.reassign",
  "billing.view",
  "billing.manage",
]);

const STAFF: ReadonlySet<Capability> = new Set<Capability>([
  "dashboard.view",
  "patients.view",
  "patients.register",
  "patients.amend",
  "documents.view",
  "documents.attach",
  "documents.archive",
  "facilities.view",
  "facilities.patientList",
  "facilities.reassign",
  "billing.view",
  "billing.manage",
]);

const ADMIN: ReadonlySet<Capability> = new Set<Capability>([
  "dashboard.view",
  "facilities.view",
  "audit.view",
  "users.view",
]);

const MATRIX: Record<Role, ReadonlySet<Capability>> = { doctor: DOCTOR, staff: STAFF, admin: ADMIN };

export function can(role: Role, capability: Capability): boolean {
  return MATRIX[role].has(capability);
}

export const SCENE_CAPABILITY: Record<SceneId, Capability> = {
  dashboard: "dashboard.view",
  patients: "patients.view",
  onboarding: "patients.register",
  documents: "documents.view",
  notes: "notes.view",
  facilities: "facilities.view",
  billing: "billing.view",
  audit: "audit.view",
};

export function canViewScene(role: Role, scene: SceneId): boolean {
  return can(role, SCENE_CAPABILITY[scene]);
}

export const SCENE_ORDER: readonly SceneId[] = [
  "dashboard",
  "patients",
  "onboarding",
  "documents",
  "notes",
  "facilities",
  "billing",
  "audit",
];

export function visibleScenes(role: Role): SceneId[] {
  return SCENE_ORDER.filter((scene) => canViewScene(role, scene));
}

export const ROLE_LABEL: Record<Role, string> = {
  doctor: "Doctor",
  staff: "Reception/Staff",
  admin: "Administrator",
};

export const ROLE_SUMMARY: Record<Role, string> = {
  doctor: "Patient records, documents, clinical notes and billing file tracking.",
  staff: "Registration, patient administration, documents and billing file tracking. No clinical notes.",
  admin: "Users, settings and the audit log. No patient files, clinical notes or billing.",
};

export const ROLES: readonly Role[] = ["doctor", "staff", "admin"];

/** Fictional people who perform actions in the demonstration. */
export const ACTORS: Record<Role, { name: string }> = {
  doctor: { name: "Dr Sipho Example" },
  staff: { name: "Lindiwe Sample (Reception)" },
  admin: { name: "Karen Sample (Administrator)" },
};

export function isRole(value: unknown): value is Role {
  return value === "doctor" || value === "staff" || value === "admin";
}
