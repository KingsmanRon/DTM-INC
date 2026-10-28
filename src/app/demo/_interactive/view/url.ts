import { isRole, SCENE_ORDER } from "@/app/demo/_interactive/state/permissions";
import type { DemoMode, PatientTab, Role, SceneId } from "@/app/demo/_interactive/types";
import { TOUR_LENGTH, TOUR_STEPS } from "./tour";

/**
 * The visible state of the demo (mode, tour step, section, simulated role,
 * selected patient) lives in the URL so every view is linkable. Only
 * non-sensitive synthetic identifiers appear in it.
 */
export interface DemoView {
  mode: DemoMode;
  /** Zero-based tour step. The URL uses one-based `step`. */
  step: number;
  scene: SceneId;
  role: Role;
  /** "p-0004", or "recent" for the patient registered during the tour. */
  patientId: string | null;
  tab: PatientTab;
}

type RawParams = URLSearchParams | Record<string, string | string[] | undefined>;

function read(params: RawParams, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export function isScene(value: unknown): value is SceneId {
  return typeof value === "string" && (SCENE_ORDER as readonly string[]).includes(value);
}

function isTab(value: unknown): value is PatientTab {
  return value === "overview" || value === "documents" || value === "notes";
}

function isPatientParam(value: unknown): value is string {
  return typeof value === "string" && /^(p-\d{4}|recent)$/.test(value);
}

export function clampStep(step: number): number {
  return Number.isFinite(step) ? Math.min(Math.max(Math.trunc(step), 0), TOUR_LENGTH - 1) : 0;
}

export function tourView(step: number): DemoView {
  const index = clampStep(step);
  const def = TOUR_STEPS[index];
  if (!def) throw new Error(`Unknown tour step: ${step}`);
  return {
    mode: "tour",
    step: index,
    scene: def.scene,
    role: def.role,
    patientId: def.patientId ?? null,
    tab: def.tab ?? "overview",
  };
}

export function exploreView(scene: SceneId = "dashboard", role: Role = "doctor", patientId: string | null = null): DemoView {
  return { mode: "explore", step: 0, scene, role, patientId, tab: "overview" };
}

export function parseView(params: RawParams): DemoView {
  const modeParam = read(params, "mode");
  const sceneParam = read(params, "scene");
  const stepParam = read(params, "step");
  const roleParam = read(params, "role");
  const patientParam = read(params, "patient");
  const tabParam = read(params, "tab");

  const mode: DemoMode =
    modeParam === "explore" ? "explore" : modeParam === "tour" ? "tour" : stepParam ? "tour" : isScene(sceneParam) ? "explore" : "tour";

  const base =
    mode === "tour"
      ? tourView(stepParam ? Number.parseInt(stepParam, 10) - 1 : 0)
      : exploreView();

  return {
    ...base,
    scene: isScene(sceneParam) ? sceneParam : base.scene,
    role: isRole(roleParam) ? roleParam : base.role,
    patientId: patientParam === "none" ? null : isPatientParam(patientParam) ? patientParam : base.patientId,
    tab: isTab(tabParam) ? tabParam : base.tab,
  };
}

export function serializeView(view: DemoView): string {
  const params = new URLSearchParams();
  params.set("mode", view.mode);
  if (view.mode === "tour") params.set("step", String(view.step + 1));
  params.set("scene", view.scene);
  params.set("role", view.role);
  if (view.patientId) params.set("patient", view.patientId);
  // A tour step may preselect a patient; "none" records that it was cleared.
  else if (view.mode === "tour" && TOUR_STEPS[view.step]?.patientId) params.set("patient", "none");
  if (view.tab !== "overview") params.set("tab", view.tab);
  return params.toString();
}

export function viewHref(view: DemoView): string {
  return `/demo?${serializeView(view)}`;
}

/** Deep link used by marketing pages: opens a section freely, as a role. */
export function demoLink(scene: SceneId, role: Role = "doctor", patientId: string | null = null): string {
  return viewHref(exploreView(scene, role, patientId));
}
