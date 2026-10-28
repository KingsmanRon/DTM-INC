"use client";

import { useState } from "react";
import { Badge, Callout } from "@/app/demo/_interactive/kit/Badge";
import { Button } from "@/app/demo/_interactive/kit/Button";
import { Dialog } from "@/app/demo/_interactive/kit/Dialog";
import { Icon } from "@/app/demo/_interactive/kit/Icon";
import { FACILITIES, PRACTICE, facilityById } from "@/app/demo/_interactive/fixtures/practice";
import { can } from "@/app/demo/_interactive/state/permissions";
import { facilityCounts } from "@/app/demo/_interactive/state/selectors";
import type { FacilityId, Patient } from "@/app/demo/_interactive/types";
import { formatDate, pluralise } from "@/app/demo/_interactive/kit/format";
import { cx } from "@/app/demo/_interactive/kit/cx";
import { PatientIdentity, RecordStatusBadge, SceneHead } from "../common";
import { useDemo } from "../DemoProvider";

type Filter = FacilityId | "all";

function ReassignDialog({ patient, onClose }: { patient: Patient | null; onClose: () => void }) {
  const { act, announce } = useDemo();
  const [target, setTarget] = useState<FacilityId | "">("");
  if (!patient) return null;
  const other = FACILITIES.filter((f) => f.id !== patient.facilityId);

  const confirm = () => {
    if (!target) return;
    act({ type: "patient/reassign", patientId: patient.id, facilityId: target });
    announce(`${patient.firstNames} ${patient.surname} moved to ${facilityById(target).name}. A new file number was issued and the old one is retired.`);
    setTarget("");
    onClose();
  };

  return (
    <Dialog open onClose={() => { setTarget(""); onClose(); }} title="Move patient to another hospital">
      <div className="stack">
        <p>
          <strong>{patient.firstNames} {patient.surname}</strong> ({patient.fileNumber}) is currently assigned to{" "}
          <strong>{facilityById(patient.facilityId).name}</strong>.
        </p>
        <fieldset className="fieldset">
          <legend>Move to</legend>
          <div className="choice-grid">
            {other.map((f) => (
              <label className="choice" key={f.id}>
                <input type="radio" name="reassign-target" checked={target === f.id} onChange={() => setTarget(f.id)} />
                <span>
                  <span className="choice__title">{f.name}</span>
                  <span className="choice__text">{f.locality}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="fine-print">
          A new file number is issued under the new hospital’s prefix. The current number is retired, never reused, and
          stays searchable. Pending billing rows for the old hospital are removed. The move is recorded in the
          patient’s history and the audit log.
        </p>
        <div className="row">
          <Button variant="primary" onClick={confirm} disabled={!target}>Confirm move</Button>
          <Button variant="ghost" onClick={() => { setTarget(""); onClose(); }}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  );
}

export function FacilitiesScene() {
  const { model, act, navigate } = useDemo();
  const [filter, setFilter] = useState<Filter>("all");
  const [moving, setMoving] = useState<Patient | null>(null);
  const [historyOf, setHistoryOf] = useState<string | null>(null);

  const showPatients = can(model.role, "facilities.patientList");
  const canReassign = can(model.role, "facilities.reassign");
  const counts = model.aggregates.byFacility;
  const patients = model.patients.filter((p) => filter === "all" || p.facilityId === filter);
  const shownCounts = showPatients ? facilityCounts(model.patients) : counts;

  const choose = (next: Filter) => {
    setFilter(next);
    act({ type: "progress/mark", key: "facilityFiltered" });
  };

  return (
    <div className="stack-lg">
      <SceneHead
        eyebrow="Hospitals"
        title="Hospitals"
        lead={`${PRACTICE.name} works across two fictional hospitals. Each hospital issues its own file numbers (NTH-2026-…, JHB-2026-…), so moving a patient issues a new number and keeps the old one searchable.`}
      />

      <Callout tone="teal" icon="shield-check">
        Both hospitals belong to one practice. Separate, independent practices never share a patient database or
        patient records.
      </Callout>

      <div className="location-grid">
        {FACILITIES.map((f) => (
          <article key={f.id} className={cx("card card--pad location", filter === f.id && "location--active")}>
            <span className="location__icon" aria-hidden="true"><Icon name="building" /></span>
            <h2 className="card__title">{f.name}</h2>
            <p className="card__lead">{f.locality}</p>
            <p className="location__desc">{f.description}</p>
            <p className="location__count">
              <strong>{shownCounts[f.id]}</strong> active {shownCounts[f.id] === 1 ? "patient" : "patients"}
            </p>
          </article>
        ))}
      </div>

      {showPatients ? (
        <section className="card card--pad" aria-labelledby="loc-patients-title">
          <div className="panel-head">
            <h2 id="loc-patients-title" className="card__title">Patients by hospital</h2>
            <div className="chips" role="group" aria-label="Filter by hospital">
              <button type="button" className={cx("chip", filter === "all" && "chip--on")} aria-pressed={filter === "all"} onClick={() => choose("all")}>
                All hospitals
              </button>
              {FACILITIES.map((f) => (
                <button key={f.id} type="button" className={cx("chip", filter === f.id && "chip--on")} aria-pressed={filter === f.id} onClick={() => choose(f.id)}>
                  {f.name}
                </button>
              ))}
            </div>
          </div>
          <p className="results-count" role="status">
            {pluralise(patients.length, "patient")} {filter === "all" ? "across both hospitals" : `at ${facilityById(filter).name}`}
          </p>
          <ul className="loc-list">
            {patients.map((p) => {
              const latest = p.assignments[p.assignments.length - 1];
              return (
                <li key={p.id} className="loc-row">
                  <PatientIdentity patient={p} />
                  <div className="loc-row__where">
                    <Badge tone="info" icon="pin">{facilityById(p.facilityId).name}</Badge>
                    <span className="loc-row__since">Since {latest ? formatDate(latest.at) : "—"}</span>
                    {p.formerFileNumbers.length > 0 ? (
                      <span className="loc-row__since mono">Formerly {p.formerFileNumbers.map((f) => f.number).join(", ")}</span>
                    ) : null}
                  </div>
                  <RecordStatusBadge patient={p} />
                  <div className="loc-row__actions">
                    <Button size="sm" icon="eye" onClick={() => navigate({ scene: "patients", patientId: p.id, tab: "overview" })} aria-label={`View file for ${p.firstNames} ${p.surname}`}>
                      View file
                    </Button>
                    {canReassign && p.recordStatus === "active" ? (
                      <Button size="sm" icon="swap" onClick={() => setMoving(p)} aria-label={`Move ${p.firstNames} ${p.surname} to another hospital`}>
                        Move
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" icon="history" aria-expanded={historyOf === p.id} onClick={() => setHistoryOf(historyOf === p.id ? null : p.id)} aria-label={`Hospital history for ${p.firstNames} ${p.surname}`}>
                      History
                    </Button>
                  </div>
                  {historyOf === p.id ? (
                    <ol className="loc-row__history" aria-label={`Hospital assignment history for ${p.firstNames} ${p.surname}`}>
                      {[...p.assignments].reverse().map((a, i) => (
                        <li key={`${a.at}-${i}`}>
                          <span className="mono">{formatDate(a.at)}</span> · {a.note} · {a.actor}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <Callout tone="info" icon="lock" title="Counts only for this role">
          The Administrator sees how many patients each hospital holds, not the patient files themselves.
        </Callout>
      )}

      <ReassignDialog patient={moving} onClose={() => setMoving(null)} />
    </div>
  );
}
