import { describe, expect, it } from "vitest";
import { buildSeedAudit } from "@/app/demo/_interactive/fixtures/audit";
import { GENESIS_REF, verifyChain } from "@/app/demo/_interactive/state/audit";
import { TOUR_LENGTH, TOUR_STEPS } from "@/app/demo/_interactive/view/tour";
import { demoLink, exploreView, parseView, serializeView, tourView } from "@/app/demo/_interactive/view/url";
import { SCENE_ORDER, visibleScenes } from "@/app/demo/_interactive/state/permissions";
import { buildEnquiryMailto } from "@/app/demo/_interactive/kit/mailto";
import { BRAND } from "@/app/demo/_interactive/brand";
import { formatDate, formatDateTime, formatMonth } from "@/app/demo/_interactive/kit/format";
import { perform, registerSample, start } from "./helpers";

describe("simulated audit integrity", () => {
  it("verifies the seeded chain", () => {
    const events = buildSeedAudit();
    expect(events[0]?.prevRef).toBe(GENESIS_REF);
    expect(verifyChain(events)).toEqual({ ok: true, checked: events.length, brokenAt: null });
  });

  it("verifies a chain extended by live actions", () => {
    const state = perform(registerSample(start()), "doctor", { type: "note/create", patientId: "p-0003", body: "Fictional." });
    expect(verifyChain(state.audit).ok).toBe(true);
  });

  it("detects an edit to a past entry", () => {
    const events = buildSeedAudit();
    const tampered = events.map((e, i) => (i === 4 ? { ...e, summary: "Edited after the fact" } : e));
    expect(verifyChain(tampered)).toEqual({ ok: false, checked: 5, brokenAt: 4 });
  });

  it("detects a removed entry", () => {
    const events = buildSeedAudit();
    const result = verifyChain(events.filter((_, i) => i !== 3));
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(3);
  });
});

describe("demo URL model", () => {
  it("defaults to the guided tour at step one", () => {
    const view = parseView(new URLSearchParams());
    expect(view).toMatchObject({ mode: "tour", step: 0, scene: "patients", role: "staff" });
  });

  it("treats a bare scene link as free exploration, as the doctor", () => {
    expect(parseView(new URLSearchParams("scene=billing"))).toMatchObject({ mode: "explore", scene: "billing", role: "doctor" });
  });

  it("accepts server-style search params", () => {
    expect(parseView({ mode: "explore", scene: ["audit", "ignored"], role: "admin" })).toMatchObject({ scene: "audit", role: "admin" });
  });

  it("opens the role and scene the step defines, with one-based steps in the URL", () => {
    expect(parseView(new URLSearchParams("mode=tour&step=4"))).toMatchObject({ step: 3, scene: "notes", role: "doctor", patientId: "p-0004" });
    expect(tourView(7)).toMatchObject({ scene: "audit", role: "admin" });
  });

  it("falls back safely on invalid input", () => {
    expect(parseView(new URLSearchParams("mode=explore&scene=../../etc&role=root&patient=<script>&tab=x"))).toEqual({
      mode: "explore",
      step: 0,
      scene: "dashboard",
      role: "doctor",
      patientId: null,
      tab: "overview",
    });
    expect(parseView(new URLSearchParams("step=999")).step).toBe(TOUR_LENGTH - 1);
    expect(parseView(new URLSearchParams("step=abc")).step).toBe(0);
  });

  it("round-trips every view", () => {
    const views = [
      tourView(0),
      tourView(3),
      { ...tourView(4), scene: "notes" as const },
      { ...tourView(3), patientId: null },
      exploreView("patients", "staff", "p-0002"),
      { ...exploreView("patients", "doctor", "recent"), tab: "documents" as const },
    ];
    for (const view of views) expect(parseView(new URLSearchParams(serializeView(view)))).toEqual(view);
  });

  it("builds deep links that carry no patient data", () => {
    expect(demoLink("billing", "staff")).toBe("/demo?mode=explore&scene=billing&role=staff");
  });
});

describe("tour script", () => {
  it("covers each scene with a valid role that can actually view it", () => {
    for (const step of TOUR_STEPS) {
      expect(SCENE_ORDER).toContain(step.scene);
      if (step.id !== "roles") expect(visibleScenes(step.role)).toContain(step.scene);
    }
  });

  it("starts every checkpoint incomplete on a fresh dataset", () => {
    const fresh = start();
    for (const step of TOUR_STEPS) for (const cp of step.checkpoints) expect(cp.done(fresh), `${step.id}/${cp.id}`).toBe(false);
  });

  it("completes checkpoints from real interactions", () => {
    const state = perform(start(), "doctor", { type: "note/create", patientId: "p-0004", body: "Fictional." });
    const notes = TOUR_STEPS.find((s) => s.id === "notes")!;
    expect(notes.checkpoints.find((c) => c.id === "created")!.done(state)).toBe(true);
    expect(notes.checkpoints.find((c) => c.id === "finalised")!.done(state)).toBe(false);
  });

  it("ends on a conversion step", () => {
    expect(TOUR_STEPS[TOUR_LENGTH - 1]?.id).toBe("next");
  });
});

describe("sales enquiry link", () => {
  it("addresses the configured sales contact with a prefilled subject and body", () => {
    const href = buildEnquiryMailto();
    expect(href.startsWith(`mailto:${BRAND.sales.email}?`)).toBe(true);
    const url = new URL(href);
    expect(url.searchParams.get("subject")).toBe(BRAND.sales.subject);
    expect(url.searchParams.get("body")).toContain("personalised demonstration");
    expect(url.searchParams.get("body")).toContain("\r\n");
  });

  it("defaults to the Inntris sales address and allows an override", () => {
    expect(BRAND.sales.email).toBe("ronald@inntris.com");
    expect(buildEnquiryMailto({ email: "sales@ricronix.example" }).startsWith("mailto:sales@ricronix.example?")).toBe(true);
  });
});

describe("date formatting", () => {
  it("is locale-independent", () => {
    expect(formatDate("2026-10-28T09:12:00+02:00")).toBe("28 Oct 2026");
    expect(formatDateTime("2026-10-28T09:12:00+02:00")).toBe("28 Oct 2026, 09:12");
    expect(formatMonth("2026-10")).toBe("October 2026");
  });
});
