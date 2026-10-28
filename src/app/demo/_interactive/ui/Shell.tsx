"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AnchorButton, Button } from "@/app/demo/_interactive/kit/Button";
import { Badge } from "@/app/demo/_interactive/kit/Badge";
import { Dialog } from "@/app/demo/_interactive/kit/Dialog";
import { Icon } from "@/app/demo/_interactive/kit/Icon";
import { BRAND } from "@/app/demo/_interactive/brand";
import { ROLES, ROLE_LABEL, ROLE_SUMMARY, can, canViewScene, visibleScenes, type Capability } from "@/app/demo/_interactive/state/permissions";
import type { Role } from "@/app/demo/_interactive/types";
import { cx } from "@/app/demo/_interactive/kit/cx";
import { buildEnquiryMailto } from "@/app/demo/_interactive/kit/mailto";
import { SCENE_META } from "./common";
import { useDemo } from "./DemoProvider";
import { TOUR_STEPS } from "@/app/demo/_interactive/view/tour";
import { viewHref } from "@/app/demo/_interactive/view/url";

export function Topbar() {
  const { view, setMode, reset } = useDemo();
  return (
    <header className="demo-topbar">
      <div className="dwrap demo-topbar__inner">
        <span className="demo-topbar__brand">
          <span className="brandmark">
            <Image src="/brand/logo.png" alt="" width={46} height={46} priority />
          </span>
          <span className="lockup__text">
            <strong className="lockup__name">{BRAND.product.name}</strong>
            <small className="lockup__sub">{BRAND.product.demoTitle}</small>
          </span>
        </span>

        <div className="demo-topbar__controls">
          <div className="segmented segmented--dark" role="group" aria-label="How to explore">
            <button type="button" className={cx("segmented__btn", view.mode === "tour" && "is-on")} aria-pressed={view.mode === "tour"} onClick={() => setMode("tour")}>
              <Icon name="play" /> Guided tour
            </button>
            <button type="button" className={cx("segmented__btn", view.mode === "explore" && "is-on")} aria-pressed={view.mode === "explore"} onClick={() => setMode("explore")}>
              <Icon name="layers" /> Explore freely
            </button>
          </div>
          <Button variant="on-dark" size="sm" icon="refresh" onClick={reset}>
            Reset demo
          </Button>
          <Link href="/demo/story" className="btn btn--on-dark btn--sm">
            <Icon name="play" /> Watch the story
          </Link>
          <AnchorButton href={buildEnquiryMailto()} variant="primary" size="sm" icon="mail">
            Request a personalised demo
          </AnchorButton>
        </div>
      </div>
    </header>
  );
}

export function Notice() {
  return (
    <div className="demo-notice" role="note">
      <div className="dwrap demo-notice__inner">
        <Icon name="shield-check" />
        <span>{BRAND.demo.notice}</span>
      </div>
    </div>
  );
}

export function SideNav() {
  const { view, navigate, model } = useDemo();
  const scenes = visibleScenes(model.role);
  return (
    <nav className="demo-nav" aria-label="Demo sections">
      <ul className="demo-nav__list">
        {scenes.map((scene) => {
          const meta = SCENE_META[scene];
          const active = view.scene === scene;
          return (
            <li key={scene}>
              <a
                href={viewHref({ ...view, scene, patientId: scene === "patients" || scene === "documents" || scene === "notes" ? view.patientId : null, tab: "overview" })}
                className={cx("demo-nav__link", active && "is-active")}
                aria-current={active ? "page" : undefined}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                  event.preventDefault();
                  navigate({ scene, patientId: scene === "patients" ? null : view.patientId, tab: "overview" });
                }}
              >
                <Icon name={meta.icon} />
                <span>{meta.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
      {!canViewScene(model.role, "notes") ? (
        <p className="demo-nav__note">
          <Icon name="lock" /> Some sections are not available to this role.
        </p>
      ) : null}
    </nav>
  );
}

const ROLE_SHORT: Record<Role, string> = { doctor: "Doctor", staff: "Staff", admin: "Admin" };

const MATRIX_ROWS: Array<{ label: string; capability: Capability }> = [
  { label: "Dashboard and reporting counts", capability: "dashboard.view" },
  { label: "Search the patient register", capability: "patients.view" },
  { label: "Register patients (onboarding)", capability: "patients.register" },
  { label: "Amend patient details", capability: "patients.amend" },
  { label: "Patient documents", capability: "documents.view" },
  { label: "Clinical notes", capability: "notes.view" },
  { label: "Patient lists by hospital, and moves", capability: "facilities.patientList" },
  { label: "Hospital counts", capability: "facilities.view" },
  { label: BRAND.features.billingTracking.label, capability: "billing.view" },
  { label: "Audit trail", capability: "audit.view" },
  { label: "Users and access", capability: "users.view" },
];

function AccessDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="How access works" wide>
      <div className="stack">
        <p>
          The role selector is a <strong>simulation for this demonstration</strong>. It is not a sign-in and nothing here
          is authenticated. It lets you compare what each role can do.
        </p>
        <p>
          In the production platform, access is enforced separately in the application, in the API and in the database.
          Hiding a menu item is never the control: the underlying data is not available to a role that should not see it.
          Multi-factor sign-in is required for every role.
        </p>
        <div className="table-wrap">
          <table className="table matrix">
            <caption className="sr-only">What each simulated role can do</caption>
            <thead>
              <tr>
                <th scope="col">Capability</th>
                {ROLES.map((r) => (
                  <th scope="col" key={r}>
                    <span className="matrix__full">{ROLE_LABEL[r]}</span>
                    <span className="matrix__short">{ROLE_SHORT[r]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MATRIX_ROWS.map((row) => (
                <tr key={row.capability}>
                  <th scope="row">{row.label}</th>
                  {ROLES.map((r) => (
                    <td key={r} data-label={ROLE_LABEL[r]}>
                      {can(r, row.capability) ? (
                        <span className="matrix__yes"><Icon name="check" label="Allowed" /></span>
                      ) : (
                        <span className="matrix__no" aria-label="Not available">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="fine-print">
          This matrix illustrates the standard role model. A deployed practice’s configuration is confirmed during setup.
        </p>
      </div>
    </Dialog>
  );
}

export function RoleBar() {
  const { view, setRole } = useDemo();
  const [open, setOpen] = useState(false);
  return (
    <section className="rolebar card" aria-labelledby="rolebar-label">
      <div className="rolebar__row">
        <p className="rolebar__label" id="rolebar-label">
          Viewing as <Badge tone="warn">Simulated role</Badge>
        </p>
        <div className="segmented" role="radiogroup" aria-labelledby="rolebar-label">
          {ROLES.map((r: Role) => (
            <label key={r} className={cx("segmented__btn", view.role === r && "is-on")}>
              <input type="radio" name="demo-role" value={r} checked={view.role === r} onChange={() => setRole(r)} />
              <span>{ROLE_LABEL[r]}</span>
            </label>
          ))}
        </div>
      </div>
      <p className="rolebar__summary">
        {ROLE_SUMMARY[view.role]}{" "}
        <button type="button" className="link-button" onClick={() => setOpen(true)}>
          How access works
        </button>
        <span className="rolebar__note"> {BRAND.demo.roleSimulationNote}</span>
      </p>
      <AccessDialog open={open} onClose={() => setOpen(false)} />
    </section>
  );
}

export function TourBar() {
  const { view, goToStep, setMode, replayTour, checkpoints } = useDemo();
  const [expanded, setExpanded] = useState(true);
  const step = TOUR_STEPS[view.step];
  if (!step) return null;
  const total = TOUR_STEPS.length;
  const isLast = view.step === total - 1;
  const done = step.checkpoints.filter((cp) => checkpoints[`${step.id}/${cp.id}`]).length;

  return (
    <section className="tour on-dark" aria-label="Guided tour">
      <div className="tour__top">
        <p className="tour__count" aria-live="polite">
          Guided tour · Step {view.step + 1} of {total}
        </p>
        <span className="tour__role">Role: {ROLE_LABEL[view.role]} (simulated)</span>
        <div className="tour__bar" role="progressbar" aria-label="Tour progress" aria-valuemin={1} aria-valuemax={total} aria-valuenow={view.step + 1}>
          <span style={{ width: `${((view.step + 1) / total) * 100}%` }} />
        </div>
        <button type="button" className="tour__toggle" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Hide details" : "Show details"}
          <Icon name="chevron-down" />
        </button>
      </div>

      <p className="eyebrow eyebrow--on-dark">{step.workflow}</p>
      <h2 className="tour__title">{step.title}</h2>

      {expanded ? (
        <div className="tour__details">
          <p className="tour__summary">{step.summary}</p>
          {step.instructions.length > 0 ? (
            <ol className="tour__try" aria-label="What to try">
              {step.instructions.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ol>
          ) : null}
          {step.checkpoints.length > 0 ? (
            <ul className="tour__checks" aria-label={`Checkpoints, ${done} of ${step.checkpoints.length} complete`}>
              {step.checkpoints.map((cp) => {
                const ok = checkpoints[`${step.id}/${cp.id}`];
                return (
                  <li key={cp.id} data-done={ok ? "true" : "false"}>
                    <Icon name={ok ? "check" : "clock"} />
                    <span>{cp.label}</span>
                    <span className="sr-only">{ok ? " (done)" : " (not yet)"}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {isLast ? (
            <div className="tour__cta">
              <AnchorButton href={buildEnquiryMailto()} variant="primary" icon="mail">
                Request a personalised demo
              </AnchorButton>
              <Button variant="on-dark" icon="layers" onClick={() => setMode("explore")}>
                Explore freely
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="tour__nav">
        <Button variant="on-dark" icon="arrow-left" onClick={() => goToStep(view.step - 1)} disabled={view.step === 0}>
          Previous
        </Button>
        {!isLast ? (
          <Button variant="primary" iconAfter="arrow-right" onClick={() => goToStep(view.step + 1)}>
            Next
          </Button>
        ) : (
          <Button variant="on-dark" icon="refresh" onClick={replayTour}>
            Replay the tour
          </Button>
        )}
        {!isLast ? (
          <Button variant="ghost" className="tour__replay" icon="refresh" onClick={replayTour}>
            Restart tour
          </Button>
        ) : null}
        <ol className="tour__dots" aria-label="Tour steps">
          {TOUR_STEPS.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                className={cx("tour__dot", i === view.step && "is-current", i < view.step && "is-past")}
                aria-label={`Go to step ${i + 1}: ${s.title}`}
                aria-current={i === view.step ? "step" : undefined}
                onClick={() => goToStep(i)}
              />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function Toast() {
  const { announcement } = useDemo();
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!announcement.text) return;
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), 5000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [announcement]);

  return (
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">
      {visible && announcement.text ? (
        <p className="toast" key={announcement.id}>
          <Icon name="check" />
          {announcement.text}
        </p>
      ) : null}
    </div>
  );
}
