import { createInitialState } from "@/app/demo/_interactive/fixtures";
import { demoReducer, type ActionInput, type DemoAction } from "@/app/demo/_interactive/state/reducer";
import { sampleDraft } from "@/app/demo/_interactive/state/onboarding";
import type { DemoState, Role } from "@/app/demo/_interactive/types";

export function start(): DemoState {
  return createInitialState();
}

/** Applies actions as the given role, mirroring how the provider adds `role`. */
export function perform(state: DemoState, role: Role, ...actions: ActionInput[]): DemoState {
  return actions.reduce((acc, action) => demoReducer(acc, { ...action, role } as DemoAction), state);
}

/** Registers the controlled sample patient as staff. */
export function registerSample(state: DemoState): DemoState {
  return perform(state, "staff", { type: "draft/set", draft: sampleDraft() }, { type: "patient/register" });
}
