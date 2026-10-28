"use client";

import type { ReactNode } from "react";
import { Button } from "@/app/demo/_interactive/kit/Button";
import { Icon, type IconName } from "@/app/demo/_interactive/kit/Icon";
import { BRAND } from "@/app/demo/_interactive/brand";
import { FACILITIES, PRACTICE, SIMULATED_USERS } from "@/app/demo/_interactive/fixtures/practice";
import { ROLE_SUMMARY } from "@/app/demo/_interactive/state/permissions";
import { BATCH_STATUS_LABEL } from "@/app/demo/_interactive/state/billing";
import { formatDate } from "@/app/demo/_interactive/kit/format";
import { SceneHead, RoleBadge } from "../common";
import { useDemo } from "../DemoProvider";

function Stat({ icon, value, label }: { icon: IconName; value: ReactNode; label: string }) {
  return (
    <div className="card stat">
      <span className="stat__icon" aria-hidden="true"><Icon name={icon} /></span>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <li className="bar">
      <span className="bar__label">{label}</span>
      <span className="bar__track" aria-hidden="true">
        <span className="bar__fill" style={{ width: `${max === 0 ? 0 : Math.max(4, (value / max) * 100)}%` }} />
      </span>
      <span className="bar__value">{value}</span>
    </li>
  );
}

export function DashboardScene() {
  const { model, navigate } = useDemo();
  const a = model.aggregates;
  const role = model.role;
  const maxLoc = Math.max(...FACILITIES.map((f) => a.byFacility[f.id]), 1);

  return (
    <div className="stack-lg">
      <SceneHead
        eyebrow={`${PRACTICE.name} · ${formatDate("2026-10-28T09:00:00+02:00")}`}
        title="Dashboard"
        lead={ROLE_SUMMARY[role]}
        actions={<RoleBadge role={role} />}
      />

      <div className="stat-grid">
        <Stat icon="users" value={a.activePatients} label="Active patient files" />
        <Stat icon="file" value={a.documentsOnFile} label="Documents on file" />
        <Stat icon="user-plus" value={a.registeredThisSession} label="Registered in this session" />
        {a.clinical ? <Stat icon="pen" value={a.clinical.drafts} label="Note drafts to finalise" /> : null}
        {a.billing ? <Stat icon="stack" value={a.billing.preparing + a.billing.ready} label="Batches in progress" /> : null}
        {a.auditEventCount !== null && !a.clinical ? <Stat icon="history" value={a.auditEventCount} label="Audit entries recorded" /> : null}
      </div>

      <div className="dash-grid">
        <section className="card card--pad" aria-labelledby="loc-report-title">
          <h2 id="loc-report-title" className="card__title">Patients by hospital</h2>
          <p className="card__lead">Active patient files in each hospital.</p>
          <ul className="bars mt">
            {FACILITIES.map((f) => (
              <Bar key={f.id} label={f.name} value={a.byFacility[f.id]} max={maxLoc} />
            ))}
          </ul>
        </section>

        {a.billing ? (
          <section className="card card--pad" aria-labelledby="pipe-title">
            <h2 id="pipe-title" className="card__title">{BRAND.features.billingTracking.label}</h2>
            <p className="card__lead">Batches by stage of handover.</p>
            <ul className="bars mt">
              {(["preparing", "ready", "handed_over", "returned"] as const).map((s) => (
                <Bar key={s} label={BATCH_STATUS_LABEL[s]} value={a.billing![s]} max={Math.max(...Object.values(a.billing!), 1)} />
              ))}
            </ul>
          </section>
        ) : null}

        {a.clinical ? (
          <section className="card card--pad" aria-labelledby="notes-report-title">
            <h2 id="notes-report-title" className="card__title">Clinical notes</h2>
            <p className="card__lead">Visible to the Doctor role only.</p>
            <ul className="bars mt">
              <Bar label="Drafts" value={a.clinical.drafts} max={Math.max(a.clinical.drafts, a.clinical.finalised, 1)} />
              <Bar label="Finalised" value={a.clinical.finalised} max={Math.max(a.clinical.drafts, a.clinical.finalised, 1)} />
              <Bar label="Amended" value={a.clinical.amended} max={Math.max(a.clinical.drafts, a.clinical.finalised, 1)} />
              <Bar label="Voided" value={a.clinical.voided} max={Math.max(a.clinical.drafts, a.clinical.finalised, 1)} />
            </ul>
          </section>
        ) : null}

        {role === "admin" ? (
          <section className="card card--pad" aria-labelledby="users-title">
            <h2 id="users-title" className="card__title">Users and access</h2>
            <p className="card__lead">Simulated practice users. Administration happens at practice level.</p>
            <ul className="user-list mt">
              {SIMULATED_USERS.map((u) => (
                <li key={u.name}>
                  <span className="avatar avatar--sm" aria-hidden="true">{u.name.split(" ").slice(-2).map((n) => n[0]).join("")}</span>
                  <span className="user-list__name">{u.name}</span>
                  <span className="user-list__role">{u.role}</span>
                </li>
              ))}
            </ul>
            <p className="fine-print mt">
              In the production platform every role signs in with multi-factor authentication. Sign-in is not simulated
              here.
            </p>
          </section>
        ) : null}
      </div>

      <section className="card card--pad" aria-labelledby="quick-title">
        <h2 id="quick-title" className="card__title">Quick actions</h2>
        <div className="row mt">
          {role !== "admin" ? (
            <>
              <Button variant="primary" icon="search" onClick={() => navigate({ scene: "patients", patientId: null })}>Find a patient</Button>
              <Button icon="user-plus" onClick={() => navigate({ scene: "onboarding", patientId: null })}>Register a patient</Button>
              <Button icon="file" onClick={() => navigate({ scene: "documents" })}>Documents</Button>
              <Button icon="stack" onClick={() => navigate({ scene: "billing" })}>{BRAND.features.billingTracking.label}</Button>
            </>
          ) : (
            <>
              <Button variant="primary" icon="history" onClick={() => navigate({ scene: "audit" })}>Review the audit trail</Button>
              <Button icon="building" onClick={() => navigate({ scene: "facilities" })}>Hospitals</Button>
            </>
          )}
          {role === "doctor" ? (
            <Button icon="stethoscope" onClick={() => navigate({ scene: "notes" })}>Clinical notes</Button>
          ) : null}
        </div>
      </section>

    </div>
  );
}
