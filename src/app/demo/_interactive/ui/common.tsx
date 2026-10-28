"use client";

import { useEffect, type ReactNode } from "react";
import { Badge } from "@/app/demo/_interactive/kit/Badge";
import { Button } from "@/app/demo/_interactive/kit/Button";
import { Icon, type IconName } from "@/app/demo/_interactive/kit/Icon";
import { facilityById } from "@/app/demo/_interactive/fixtures/practice";
import { derivePayerLabel } from "@/app/demo/_interactive/state/billing";
import { ROLE_LABEL } from "@/app/demo/_interactive/state/permissions";
import { patientName } from "@/app/demo/_interactive/state/selectors";
import type { FacilityId, Patient, Role, SceneId } from "@/app/demo/_interactive/types";
import { useDemo } from "./DemoProvider";

export const SCENE_META: Record<SceneId, { label: string; icon: IconName }> = {
  dashboard: { label: "Dashboard", icon: "dashboard" },
  patients: { label: "Patients", icon: "users" },
  onboarding: { label: "Onboarding", icon: "user-plus" },
  documents: { label: "Documents", icon: "file" },
  notes: { label: "Clinical Notes", icon: "stethoscope" },
  facilities: { label: "Hospitals", icon: "building" },
  billing: { label: "Billing File Tracking", icon: "stack" },
  audit: { label: "Audit Trail", icon: "history" },
};

export function SceneHead({
  eyebrow,
  title,
  lead,
  actions,
}: {
  eyebrow: string;
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="scene-head">
      <div className="scene-head__text">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="scene-head__title">{title}</h1>
        {lead ? <p className="scene-head__lead">{lead}</p> : null}
      </div>
      {actions ? <div className="scene-head__actions">{actions}</div> : null}
    </header>
  );
}

/**
 * Shown when the current simulated role may not open a section. The section's
 * data was never loaded into this role's view (see projectForRole), so there is
 * nothing behind this panel to reveal.
 */
export function AccessDenied({ scene }: { scene: SceneId }) {
  const { view, navigate, setRole, act } = useDemo();
  const label = SCENE_META[scene].label;

  useEffect(() => {
    if (scene === "notes") act({ type: "progress/mark", key: "accessProbed" });
  }, [scene, act]);

  return (
    <section className="card card--pad denied" aria-labelledby="denied-title">
      <span className="denied__icon" aria-hidden="true">
        <Icon name="lock" />
      </span>
      <h1 id="denied-title" className="denied__title">
        Not available for this role
      </h1>
      <p className="denied__text">
        <strong>{label}</strong> is not available to <strong>{ROLE_LABEL[view.role]}</strong>. Nothing from this section
        is loaded into this view, so there is nothing to reveal by changing the address or navigating directly.
      </p>
      <p className="denied__text denied__text--muted">
        This is a simulation of the access model. In the production platform the same boundary is enforced separately in
        the application, the API and the database.
      </p>
      <div className="denied__actions">
        <Button variant="primary" icon="arrow-left" onClick={() => navigate({ scene: "dashboard" })}>
          Back to the dashboard
        </Button>
        {view.role !== "doctor" && scene === "notes" ? (
          <Button variant="secondary" onClick={() => setRole("doctor")}>
            Switch to Doctor (simulated)
          </Button>
        ) : null}
      </div>
    </section>
  );
}

export function FacilityBadge({ id }: { id: FacilityId }) {
  return (
    <Badge tone="info" icon="pin">
      {facilityById(id).shortName}
    </Badge>
  );
}

export function PayerBadge({ patient }: { patient: Pick<Patient, "payer"> }) {
  const payer = derivePayerLabel(patient.payer);
  if (payer.kind === "cash") return <Badge tone="neutral">CASH (private payer)</Badge>;
  if (payer.kind === "missing") return <Badge tone="warn" icon="alert">Number missing</Badge>;
  return <Badge tone="neutral">Medical aid</Badge>;
}

export function RecordStatusBadge({ patient }: { patient: Pick<Patient, "recordStatus"> }) {
  return patient.recordStatus === "active" ? (
    <Badge tone="success" icon="check">Active</Badge>
  ) : (
    <Badge tone="neutral" icon="archive">Archived</Badge>
  );
}

export function RoleBadge({ role }: { role: Role }) {
  return <Badge tone={role === "doctor" ? "teal" : role === "admin" ? "navy" : "info"}>{ROLE_LABEL[role]}</Badge>;
}

export function PatientIdentity({
  patient,
  size = "md",
  asHeading = false,
}: {
  patient: Patient;
  size?: "sm" | "md" | "lg";
  /** Render the name as the page's level-1 heading (patient profile). */
  asHeading?: boolean;
}) {
  const initials = `${patient.firstNames.charAt(0)}${patient.surname.charAt(0)}`.toUpperCase();
  return (
    <span className="identity">
      <span className={size === "lg" ? "avatar avatar--lg" : size === "sm" ? "avatar avatar--sm" : "avatar"} aria-hidden="true">
        {initials}
      </span>
      <span className="identity__text">
        {asHeading ? (
          <h1 className="identity__name identity__name--heading">{patientName(patient)}</h1>
        ) : (
          <span className="identity__name">{patientName(patient)}</span>
        )}
        <span className="identity__meta mono">{patient.fileNumber}</span>
      </span>
    </span>
  );
}

export function PatientPicker({
  label = "Patient file",
  patients,
  value,
  onChange,
}: {
  label?: string;
  patients: readonly Patient[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <div className="field picker">
      <label className="field__label" htmlFor="patient-picker">
        {label}
      </label>
      <select id="patient-picker" className="select" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        {value === null ? <option value="">Choose a patient…</option> : null}
        {patients.map((p) => (
          <option key={p.id} value={p.id}>
            {p.surname}, {p.firstNames} — {p.fileNumber}
            {p.recordStatus === "archived" ? " (archived)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
