"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createInitialState } from "@/app/demo/_interactive/fixtures";
import { demoReducer, type ActionInput, type DemoAction } from "@/app/demo/_interactive/state/reducer";
import { projectForRole, type RoleModel } from "@/app/demo/_interactive/state/selectors";
import { SESSION_START } from "@/app/demo/_interactive/state/clock";
import type { DemoMode, DemoState, Role } from "@/app/demo/_interactive/types";
import { TOUR_STEPS } from "@/app/demo/_interactive/view/tour";
import { parseView, tourView, viewHref, type DemoView } from "@/app/demo/_interactive/view/url";

interface DemoContextValue {
  view: DemoView;
  /** The selected patient id with the "recent" alias resolved. */
  patientId: string | null;
  /** Everything the current role may see. Components never receive raw state. */
  model: RoleModel;
  act: (action: ActionInput) => void;
  navigate: (patch: Partial<DemoView>, options?: { replace?: boolean }) => void;
  goToStep: (step: number) => void;
  setMode: (mode: DemoMode) => void;
  setRole: (role: Role) => void;
  reset: () => void;
  replayTour: () => void;
  /** Tour checkpoint completion, keyed "stepId/checkpointId". */
  checkpoints: Record<string, boolean>;
  announce: (message: string) => void;
  announcement: { id: number; text: string };
  /** Increments on reset so scenes can drop local UI state. */
  resetKey: number;
}

const DemoContext = createContext<DemoContextValue | null>(null);

export function useDemo(): DemoContextValue {
  const value = useContext(DemoContext);
  if (!value) throw new Error("useDemo must be used inside <DemoProvider>");
  return value;
}

function resolveRecent(state: DemoState): string {
  const created = state.patients.filter((p) => p.createdAt >= SESSION_START);
  return created[created.length - 1]?.id ?? "p-0001";
}

export function DemoProvider({ initialView, children }: { initialView: DemoView; children: ReactNode }) {
  const [view, setView] = useState<DemoView>(initialView);
  const [state, dispatch] = useReducer(demoReducer, undefined, createInitialState);
  const [announcement, setAnnouncement] = useState({ id: 0, text: "" });
  const [resetKey, setResetKey] = useState(0);
  const viewRef = useRef(view);

  const commit = useCallback((next: DemoView, replace: boolean) => {
    viewRef.current = next;
    setView(next);
    const url = viewHref(next);
    if (replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
  }, []);

  const navigate = useCallback(
    (patch: Partial<DemoView>, options?: { replace?: boolean }) => commit({ ...viewRef.current, ...patch }, options?.replace ?? false),
    [commit],
  );

  // Back/forward buttons restore the previous view.
  useEffect(() => {
    const onPop = () => {
      const next = parseView(new URLSearchParams(window.location.search));
      viewRef.current = next;
      setView(next);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    dispatch({ type: "role/seen", role: view.role });
  }, [view.role]);

  const act = useCallback(
    (action: ActionInput) => dispatch({ ...action, role: viewRef.current.role } as DemoAction),
    [],
  );

  const announce = useCallback((text: string) => setAnnouncement((prev) => ({ id: prev.id + 1, text })), []);

  const goToStep = useCallback((step: number) => commit(tourView(step), false), [commit]);

  const setMode = useCallback(
    (mode: DemoMode) => {
      const current = viewRef.current;
      if (current.mode === mode) return;
      if (mode === "tour") commit(tourView(current.step), false);
      else commit({ ...current, mode: "explore" }, false);
    },
    [commit],
  );

  const setRole = useCallback((role: Role) => navigate({ role }, { replace: true }), [navigate]);

  const reset = useCallback(() => {
    dispatch({ type: "reset", role: viewRef.current.role });
    setResetKey((key) => key + 1);
    announce("Demo reset to the original synthetic dataset.");
  }, [announce]);

  const replayTour = useCallback(() => {
    dispatch({ type: "reset", role: tourView(0).role });
    setResetKey((key) => key + 1);
    commit(tourView(0), false);
    announce("Tour restarted with the original synthetic dataset.");
  }, [commit, announce]);

  const model = useMemo(() => projectForRole(state, view.role), [state, view.role]);

  const patientId = view.patientId === "recent" ? resolveRecent(state) : view.patientId;

  const checkpoints = useMemo(
    () =>
      Object.fromEntries(
        TOUR_STEPS.flatMap((step) => step.checkpoints.map((cp) => [`${step.id}/${cp.id}`, cp.done(state)] as const)),
      ),
    [state],
  );

  const value = useMemo<DemoContextValue>(
    () => ({
      view,
      patientId,
      model,
      act,
      navigate,
      goToStep,
      setMode,
      setRole,
      reset,
      replayTour,
      checkpoints,
      announce,
      announcement,
      resetKey,
    }),
    [view, patientId, model, act, navigate, goToStep, setMode, setRole, reset, replayTour, checkpoints, announce, announcement, resetKey],
  );

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}
