"use client";

import { useState, type ReactNode } from "react";
import { Badge, Callout } from "@/app/demo/_interactive/kit/Badge";
import { Button } from "@/app/demo/_interactive/kit/Button";
import { TextField, TextAreaField } from "@/app/demo/_interactive/kit/Fields";
import { Icon } from "@/app/demo/_interactive/kit/Icon";
import { REFERRAL_SOURCES, facilityById } from "@/app/demo/_interactive/fixtures/practice";
import { can } from "@/app/demo/_interactive/state/permissions";
import { validateContactChanges, type ContactChanges } from "@/app/demo/_interactive/state/onboarding";
import { documentCompleteness, patientName } from "@/app/demo/_interactive/state/selectors";
import type { Patient, PatientTab } from "@/app/demo/_interactive/types";
import { formatDate, formatDateTime } from "@/app/demo/_interactive/kit/format";
import { cx } from "@/app/demo/_interactive/kit/cx";
import { FacilityBadge, PatientIdentity, PayerBadge, RecordStatusBadge } from "../common";
import { useDemo } from "../DemoProvider";
import { DocumentsPanel } from "./DocumentsPanel";
import { NotesPanel } from "./NotesPanel";

function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="facts">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value || <span className="muted">Not recorded</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

function EditContact({ patient, onDone }: { patient: Patient; onDone: () => void }) {
  const { act, announce } = useDemo();
  const aid = patient.payer.kind === "medical_aid" ? patient.payer : null;
  const [values, setValues] = useState({
    phone: patient.phone,
    email: patient.email,
    address: patient.address,
    membershipNumber: aid?.membershipNumber ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = () => {
    const changes: ContactChanges = { phone: values.phone, email: values.email, address: values.address };
    if (aid) changes.membershipNumber = values.membershipNumber;
    const found = validateContactChanges(changes);
    if (Object.keys(found).length > 0) return setErrors(found);
    const changed =
      values.phone.trim() !== patient.phone ||
      values.email.trim() !== patient.email ||
      values.address.trim() !== patient.address ||
      (aid ? values.membershipNumber.trim() !== aid.membershipNumber : false);
    if (!changed) return setErrors({ phone: "Change at least one detail before saving." });
    act({ type: "patient/amend", patientId: patient.id, changes });
    announce("Patient details amended and recorded in the audit trail.");
    onDone();
  };

  return (
    <section className="card card--pad" aria-labelledby="edit-title">
      <h2 id="edit-title" className="card__title">Amend contact and payer details</h2>
      <p className="card__lead">Changes are recorded with who made them and when. Fictional data only.</p>
      <div className="form-grid form-grid--2 mt">
        <TextField name="edit.phone" label="Phone number" value={values.phone} onChange={(e) => setValues({ ...values, phone: e.target.value })} error={errors.phone} />
        <TextField name="edit.email" label="Email address" optional value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} error={errors.email} />
        {aid ? (
          <TextField name="edit.membershipNumber" label="Medical aid number" value={values.membershipNumber} onChange={(e) => setValues({ ...values, membershipNumber: e.target.value })} error={errors.membershipNumber} />
        ) : null}
        <TextAreaField className="span-2" name="edit.address" label="Address" value={values.address} onChange={(e) => setValues({ ...values, address: e.target.value })} error={errors.address} />
      </div>
      <div className="row mt">
        <Button variant="primary" onClick={save}>Save changes</Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </section>
  );
}

function Overview({ patient }: { patient: Patient }) {
  const { model, navigate } = useDemo();
  const [editing, setEditing] = useState(false);
  const canAmend = can(model.role, "patients.amend") && patient.recordStatus === "active";
  const completeness = documentCompleteness(patient, model.documents);
  const missing = completeness.filter((c) => !c.present).length;
  const referral = REFERRAL_SOURCES.find((r) => r.value === patient.referral.source)?.label ?? patient.referral.source;

  const changes = [
    ...patient.amendments.map((a) => ({ at: a.at, text: `${a.field} changed by ${a.actor}`, detail: `${a.from} → ${a.to}` })),
    ...patient.assignments.map((a) => ({ at: a.at, text: `${a.note} (${a.actor})`, detail: facilityById(a.facilityId).name })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="stack-lg">
      {editing ? <EditContact patient={patient} onDone={() => setEditing(false)} /> : null}

      <div className="profile-grid">
        <section className="card card--pad" aria-labelledby="demo-title">
          <div className="panel-head">
            <h2 id="demo-title" className="card__title">Demographics</h2>
            {canAmend && !editing ? (
              <Button size="sm" icon="pen" onClick={() => setEditing(true)}>Amend details</Button>
            ) : null}
          </div>
          <Facts
            items={[
              ["Date of birth", formatDate(`${patient.dateOfBirth}T00:00:00+02:00`)],
              ["Identity", `${patient.idType === "passport" ? "Passport" : "ID number"} (synthetic): ${patient.idNumber}`],
              ["Phone", patient.phone],
              ["Email", patient.email],
              ["Address", patient.address],
              ["Hospital", facilityById(patient.facilityId).name],
              ["File opened", formatDate(patient.createdAt)],
              [
                "Former file numbers",
                patient.formerFileNumbers.length ? (
                  <span key="former" className="mono">
                    {patient.formerFileNumbers.map((f) => f.number).join(", ")} (retired, still searchable)
                  </span>
                ) : null,
              ],
            ]}
          />
        </section>

        <section className="card card--pad" aria-labelledby="payer-title">
          <h2 id="payer-title" className="card__title">Medical aid or payer</h2>
          {patient.payer.kind === "medical_aid" ? (
            <Facts
              items={[
                ["Scheme (fictional)", patient.payer.scheme],
                ["Plan", patient.payer.plan],
                [
                  "Membership number",
                  patient.payer.membershipNumber ? (
                    <span className="mono">{patient.payer.membershipNumber}</span>
                  ) : (
                    <Badge tone="warn" icon="alert">Missing: add it on this record</Badge>
                  ),
                ],
              ]}
            />
          ) : (
            <Facts items={[["Payer", "Private payer (no medical aid). Recorded as CASH when files are tracked."]]} />
          )}
        </section>

        <section className="card card--pad" aria-labelledby="resp-title">
          <h2 id="resp-title" className="card__title">Responsible party</h2>
          <Facts
            items={[
              ["Name", patient.responsible.sameAsPatient ? `${patientName(patient)} (the patient)` : patient.responsible.name],
              ["Relationship", patient.responsible.relationship],
              ["Phone", patient.responsible.phone],
            ]}
          />
        </section>

        <section className="card card--pad" aria-labelledby="em-title">
          <h2 id="em-title" className="card__title">Emergency contact and referral</h2>
          <Facts
            items={[
              ["Emergency contact", `${patient.emergency.name} (${patient.emergency.relationship}), ${patient.emergency.phone}`],
              ["Referred by", patient.referral.source === "self" ? "Self-referred" : `${patient.referral.name} (${referral})`],
              ["Referral note", patient.referral.notes],
            ]}
          />
        </section>

        <section className="card card--pad" aria-labelledby="dep-title">
          <h2 id="dep-title" className="card__title">Dependants</h2>
          {patient.dependants.length === 0 ? (
            <p className="card__lead">No dependants recorded.</p>
          ) : (
            <ul className="plain-list">
              {patient.dependants.map((d) => (
                <li key={d.code + d.name}>
                  <strong>{d.name}</strong> · code {d.code} · born {formatDate(`${d.dateOfBirth}T00:00:00+02:00`)}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card card--pad" aria-labelledby="consent-title">
          <h2 id="consent-title" className="card__title">Consent and record status</h2>
          <Facts
            items={[
              ["Consent", patient.consent.agreed ? `Given by ${patient.consent.signedName} on ${formatDate(patient.consent.capturedAt)}` : "Not recorded"],
              ["Wording", patient.consent.wordingVersion],
              ["Record status", <RecordStatusBadge key="s" patient={patient} />],
              [
                "File checklist",
                <span key="c">
                  {missing === 0 ? "Complete" : `${missing} item${missing === 1 ? "" : "s"} missing`}{" "}
                  <button type="button" className="link-button" onClick={() => navigate({ tab: "documents" })}>
                    Open documents
                  </button>
                </span>,
              ],
            ]}
          />
        </section>
      </div>

      <section className="card card--pad" aria-labelledby="changes-title">
        <h2 id="changes-title" className="card__title">Record changes</h2>
        <p className="card__lead">Detail amendments and hospital assignments, newest first.</p>
        <ul className="changes mt">
          {changes.map((c, i) => (
            <li key={`${c.at}-${i}`}>
              <span className="mono changes__when">{formatDateTime(c.at)}</span>
              <span>
                {c.text}
                <span className="changes__detail">{c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function PatientProfile({ patient }: { patient: Patient }) {
  const { view, model, navigate } = useDemo();
  const canNotes = can(model.role, "notes.view");
  const tab: PatientTab = view.tab === "notes" && !canNotes ? "overview" : view.tab;

  const tabs: Array<{ id: PatientTab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "documents", label: "Documents" },
    ...(canNotes ? [{ id: "notes" as const, label: "Clinical notes" }] : []),
  ];

  return (
    <div className="stack-lg">
      <div className="profile-head card card--pad">
        <Button variant="ghost" size="sm" icon="arrow-left" onClick={() => navigate({ patientId: null, tab: "overview" })}>
          Back to the register
        </Button>
        <div className="profile-head__main">
          <PatientIdentity patient={patient} size="lg" asHeading />
          <div className="profile-head__badges">
            <RecordStatusBadge patient={patient} />
            <FacilityBadge id={patient.facilityId} />
            <PayerBadge patient={patient} />
          </div>
        </div>
        {patient.recordStatus === "archived" ? (
          <Callout tone="warn" icon="archive">
            This record is archived. It stays searchable and keeps its full history, but it can no longer be edited.
          </Callout>
        ) : null}
      </div>

      <div className="tabs" role="tablist" aria-label="Patient file sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="profile-panel"
            tabIndex={tab === t.id ? 0 : -1}
            className={cx("tab", tab === t.id && "tab--active")}
            onClick={() => navigate({ tab: t.id })}
            onKeyDown={(event) => {
              const index = tabs.findIndex((x) => x.id === t.id);
              const next = event.key === "ArrowRight" ? tabs[(index + 1) % tabs.length] : event.key === "ArrowLeft" ? tabs[(index - 1 + tabs.length) % tabs.length] : null;
              if (next) {
                event.preventDefault();
                navigate({ tab: next.id });
                requestAnimationFrame(() => document.getElementById(`tab-${next.id}`)?.focus());
              }
            }}
          >
            {t.id === "notes" ? <Icon name="lock" /> : null}
            {t.label}
          </button>
        ))}
      </div>

      <div id="profile-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "overview" ? <Overview patient={patient} /> : null}
        {tab === "documents" ? <DocumentsPanel patient={patient} /> : null}
        {tab === "notes" && canNotes ? <NotesPanel patient={patient} /> : null}
      </div>
    </div>
  );
}
