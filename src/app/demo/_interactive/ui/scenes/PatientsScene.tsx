"use client";

import { useEffect, useMemo, useState } from "react";
import { Callout } from "@/app/demo/_interactive/kit/Badge";
import { Button } from "@/app/demo/_interactive/kit/Button";
import { SelectField, TextField } from "@/app/demo/_interactive/kit/Fields";
import { Icon } from "@/app/demo/_interactive/kit/Icon";
import { findDuplicateByIdentity, validateIdentifier } from "@/app/demo/_interactive/state/onboarding";
import { formerNumberMatch, patientListName, searchPatients } from "@/app/demo/_interactive/state/selectors";
import { can } from "@/app/demo/_interactive/state/permissions";
import type { Patient } from "@/app/demo/_interactive/types";
import { SceneHead, FacilityBadge, PatientIdentity, RecordStatusBadge } from "../common";
import { useDemo } from "../DemoProvider";
import { PatientProfile } from "../panels/PatientProfile";

type CheckResult =
  | { kind: "duplicate"; patient: Patient }
  | { kind: "clear" }
  | { kind: "invalid"; message: string }
  | null;

function IdentityCheck({ onClose }: { onClose: () => void }) {
  const { model, act, navigate } = useDemo();
  const [idType, setIdType] = useState<"id" | "passport">("id");
  const [identifier, setIdentifier] = useState("");
  const [result, setResult] = useState<CheckResult>(null);

  const run = () => {
    const invalid = validateIdentifier(idType, identifier);
    if (invalid) return setResult({ kind: "invalid", message: invalid });
    const existing = findDuplicateByIdentity(model.patients, idType, identifier);
    if (existing) {
      setResult({ kind: "duplicate", patient: existing });
      act({ type: "progress/mark", key: "duplicateBlocked" });
    } else {
      setResult({ kind: "clear" });
    }
  };

  const continueToOnboarding = () => {
    act({
      type: "draft/set",
      draft: {
        ...model.draft,
        patient: { ...model.draft.patient, idType, idNumber: identifier.trim().toUpperCase() },
      },
    });
    navigate({ scene: "onboarding", patientId: null });
  };

  return (
    <section className="card card--pad identity-check" aria-labelledby="idcheck-title" id="identity-check">
      <div className="panel-head">
        <div>
          <h2 id="idcheck-title" className="card__title">Check before creating a patient file</h2>
          <p className="card__lead">
            The register is checked for an existing file with the same identifier before a new one can be started.
          </p>
        </div>
        <Button size="sm" variant="ghost" icon="x" onClick={onClose} aria-label="Close identity check">
          Close
        </Button>
      </div>

      <div className="form-grid form-grid--2 mt">
        <SelectField
          name="check.idType"
          label="Identity type"
          value={idType}
          onChange={(e) => {
            setIdType(e.target.value as "id" | "passport");
            setResult(null);
          }}
        >
          <option value="id">ID number (synthetic)</option>
          <option value="passport">Passport (synthetic)</option>
        </SelectField>
        <TextField
          name="check.identifier"
          label="Synthetic identifier"
          autoComplete="off"
          placeholder={idType === "id" ? "SYN-ID-10004" : "SYN-PP-30001"}
          value={identifier}
          onChange={(e) => {
            setIdentifier(e.target.value);
            setResult(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") run();
          }}
          error={result?.kind === "invalid" ? result.message : undefined}
        />
      </div>

      <div className="row mt">
        <Button variant="primary" icon="search" onClick={run}>Run identity check</Button>
        <Button
          variant="ghost"
          onClick={() => {
            setIdType("id");
            setIdentifier("SYN-ID-10004");
            setResult(null);
          }}
        >
          Use an existing patient’s identifier
        </Button>
      </div>

      <div aria-live="polite" className="mt">
        {result?.kind === "duplicate" ? (
          <div className="blocked">
            <Callout tone="danger" icon="ban" title="Duplicate file blocked">
              A file already exists in this practice for that identifier:{" "}
              <strong>{patientListName(result.patient)}</strong> ({result.patient.fileNumber}). Creating a second file for
              the same patient is not allowed. Open the existing file instead.
            </Callout>
            <div className="row mt">
              <Button
                variant="primary"
                iconAfter="arrow-right"
                onClick={() => navigate({ patientId: result.patient.id, tab: "overview" })}
              >
                Open the existing file
              </Button>
              <Button disabled icon="ban" aria-disabled="true">Create new patient file (blocked)</Button>
            </div>
          </div>
        ) : null}
        {result?.kind === "clear" ? (
          <div>
            <Callout tone="success" icon="check" title="No existing file found">
              Nothing in this practice’s register uses that identifier, so a new patient file can be started.
            </Callout>
            <div className="row mt">
              <Button variant="primary" iconAfter="arrow-right" onClick={continueToOnboarding}>
                Continue to onboarding
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <p className="fine-print mt">
        This demonstration matches the exact identifier within one practice’s register. It does not verify identity with
        Home Affairs or any government service.
      </p>
    </section>
  );
}

export function PatientsScene() {
  const { model, patientId, navigate, act } = useDemo();
  const [query, setQuery] = useState("");
  const [checkOpen, setCheckOpen] = useState(false);
  const canRegister = can(model.role, "patients.register");

  const trimmed = query.trim();
  const searching = trimmed.length >= 2;

  const register = useMemo(
    () =>
      [...model.patients].sort(
        (a, b) =>
          Number(a.recordStatus === "archived") - Number(b.recordStatus === "archived") ||
          a.surname.localeCompare(b.surname),
      ),
    [model.patients],
  );
  const results = useMemo(() => (searching ? searchPatients(model.patients, trimmed) : register), [searching, model.patients, trimmed, register]);

  useEffect(() => {
    if (searching && results.length > 0) act({ type: "progress/mark", key: "searched" });
  }, [searching, results.length, act]);

  if (patientId) {
    const selected = model.patients.find((p) => p.id === patientId);
    if (selected) return <PatientProfile patient={selected} />;
    return (
      <div className="stack-lg">
        <SceneHead eyebrow="Patient registry" title="Patient not found" />
        <div className="empty">
          <strong>That patient is not in the current session</strong>
          <span>The register may have been reset. Return to the register to continue.</span>
          <Button variant="primary" onClick={() => navigate({ patientId: null })}>Back to the register</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <SceneHead
        eyebrow="Patient search and duplicate prevention"
        title="Patient registry"
        lead="Find a patient by name, synthetic identifier or file number, including a former file number. Every patient has one file in the practice register."
        actions={
          canRegister ? (
            <Button variant="primary" icon="user-plus" onClick={() => setCheckOpen(true)} aria-expanded={checkOpen} aria-controls="identity-check">
              New patient
            </Button>
          ) : null
        }
      />

      {checkOpen && canRegister ? <IdentityCheck onClose={() => setCheckOpen(false)} /> : null}

      <section className="card card--pad" aria-labelledby="register-title">
        <h2 id="register-title" className="sr-only">Search the register</h2>
        <div className="search">
          <Icon name="search" />
          <label htmlFor="patient-search" className="sr-only">Search patients</label>
          <input
            id="patient-search"
            type="search"
            className="input search__input"
            placeholder="Search by name, identifier or file number"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <p className="field__hint mt-sm">
          Try{" "}
          {["Dube", "SYN-ID-10004", "NTH-2026-000106"].map((example, i) => (
            <span key={example}>
              {i > 0 ? ", " : ""}
              <button type="button" className="link-button" onClick={() => setQuery(example)}>
                {example}
              </button>
            </span>
          ))}
        </p>

        <p className="results-count" role="status">
          {searching
            ? `${results.length} ${results.length === 1 ? "match" : "matches"} for “${trimmed}”`
            : `${register.length} files in the register`}
        </p>

        {results.length === 0 ? (
          <div className="empty">
            <strong>No patient found</strong>
            <span>Nothing matches “{trimmed}”. Before creating a file, run the identity check to confirm no file exists.</span>
            {canRegister ? <Button onClick={() => setCheckOpen(true)} icon="user-plus">New patient</Button> : null}
          </div>
        ) : (
          <ul className="patient-list" aria-label="Patients">
            {results.map((p) => (
              <li key={p.id}>
                <button type="button" className="patient-row" onClick={() => navigate({ patientId: p.id, tab: "overview" })}>
                  <PatientIdentity patient={p} />
                  <span className="patient-row__id mono">
                    {p.idNumber}
                    {searching && formerNumberMatch(p, trimmed) ? (
                      <span className="patient-row__former"> Matched former number {formerNumberMatch(p, trimmed)}</span>
                    ) : null}
                  </span>
                  <span className="patient-row__badges">
                    <FacilityBadge id={p.facilityId} />
                    <RecordStatusBadge patient={p} />
                  </span>
                  <Icon name="chevron-right" className="patient-row__chev" />
                  <span className="sr-only">Open file</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
