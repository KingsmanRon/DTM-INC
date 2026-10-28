"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Badge, Callout } from "@/app/demo/_interactive/kit/Badge";
import { Button } from "@/app/demo/_interactive/kit/Button";
import { FieldError, SelectField, TextAreaField, TextField, fieldId } from "@/app/demo/_interactive/kit/Fields";
import { Icon } from "@/app/demo/_interactive/kit/Icon";
import { FACILITIES, REFERRAL_SOURCES, SCHEMES, TITLES, facilityById } from "@/app/demo/_interactive/fixtures/practice";
import {
  STEP_COUNT,
  STEP_LABELS,
  applySampleToStep,
  emptyDependant,
  findDuplicateByIdentity,
  sampleDraft,
  validateAll,
  validateDependant,
  validateStep,
  type FieldErrors,
} from "@/app/demo/_interactive/state/onboarding";
import { patientListName } from "@/app/demo/_interactive/state/selectors";
import type { OnboardingDraft, Patient } from "@/app/demo/_interactive/types";
import { formatDate } from "@/app/demo/_interactive/kit/format";
import { cx } from "@/app/demo/_interactive/kit/cx";
import { SceneHead } from "../common";
import { useDemo } from "../DemoProvider";

type ObjectSection = "patient" | "responsible" | "payer" | "emergency" | "referral" | "consent";

interface StepProps {
  draft: OnboardingDraft;
  errors: FieldErrors;
  update: <K extends ObjectSection>(section: K, patch: Partial<OnboardingDraft[K]>) => void;
  setDraft: (draft: OnboardingDraft) => void;
  clearError: (key: string) => void;
}

function StepPatient({ draft, errors, update, clearError }: StepProps) {
  const p = draft.patient;
  const change = <K extends keyof OnboardingDraft["patient"]>(key: K, value: OnboardingDraft["patient"][K]) => {
    update("patient", { [key]: value } as Partial<OnboardingDraft["patient"]>);
    clearError(`patient.${key}`);
  };
  return (
    <div className="form-grid form-grid--2">
      <SelectField name="patient.facilityId" label="Hospital" value={p.facilityId} error={errors["patient.facilityId"]} onChange={(e) => change("facilityId", e.target.value as OnboardingDraft["patient"]["facilityId"])}>
        <option value="">Choose a hospital…</option>
        {FACILITIES.map((f) => (
          <option key={f.id} value={f.id}>{f.name}</option>
        ))}
      </SelectField>
      <SelectField name="patient.title" label="Title" value={p.title} error={errors["patient.title"]} onChange={(e) => change("title", e.target.value)}>
        <option value="">Choose…</option>
        {TITLES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </SelectField>
      <TextField name="patient.firstNames" label="First names" autoComplete="off" value={p.firstNames} error={errors["patient.firstNames"]} onChange={(e) => change("firstNames", e.target.value)} />
      <TextField name="patient.surname" label="Surname" autoComplete="off" value={p.surname} error={errors["patient.surname"]} onChange={(e) => change("surname", e.target.value)} />
      <SelectField name="patient.idType" label="Identity type" value={p.idType} onChange={(e) => change("idType", e.target.value as "id" | "passport")}>
        <option value="id">ID number (synthetic)</option>
        <option value="passport">Passport (synthetic)</option>
      </SelectField>
      <TextField
        name="patient.idNumber"
        label="Synthetic identifier"
        autoComplete="off"
        placeholder={p.idType === "id" ? "SYN-ID-20001" : "SYN-PP-30002"}
        hint="Demonstration identifiers only (SYN-ID-##### or SYN-PP-#####). Real ID numbers are not accepted."
        value={p.idNumber}
        error={errors["patient.idNumber"]}
        onChange={(e) => change("idNumber", e.target.value)}
      />
      <TextField name="patient.dateOfBirth" label="Date of birth" type="date" max="2026-10-28" value={p.dateOfBirth} error={errors["patient.dateOfBirth"]} onChange={(e) => change("dateOfBirth", e.target.value)} />
      <TextField name="patient.phone" label="Phone number" type="tel" autoComplete="off" value={p.phone} error={errors["patient.phone"]} onChange={(e) => change("phone", e.target.value)} />
      <TextField className="span-2" name="patient.email" label="Email address" optional type="email" autoComplete="off" value={p.email} error={errors["patient.email"]} onChange={(e) => change("email", e.target.value)} />
      <TextAreaField className="span-2" name="patient.address" label="Physical address" autoComplete="off" value={p.address} error={errors["patient.address"]} onChange={(e) => change("address", e.target.value)} />
    </div>
  );
}

function StepResponsible({ draft, errors, update, clearError }: StepProps) {
  const r = draft.responsible;
  const change = (key: keyof OnboardingDraft["responsible"], value: string | boolean) => {
    update("responsible", { [key]: value } as Partial<OnboardingDraft["responsible"]>);
    clearError(`responsible.${key}`);
  };
  return (
    <div className="stack">
      <label className="choice">
        <input type="checkbox" id={fieldId("responsible.sameAsPatient")} checked={r.sameAsPatient} onChange={(e) => change("sameAsPatient", e.target.checked)} />
        <span>
          <span className="choice__title">The patient is responsible for the account</span>
          <span className="choice__text">Untick this to record a different responsible person, such as a parent or guardian.</span>
        </span>
      </label>
      {r.sameAsPatient ? (
        <Callout tone="teal" icon="check">
          The patient’s own details will be used for the responsible party.
        </Callout>
      ) : (
        <div className="form-grid form-grid--2">
          <TextField name="responsible.name" label="Full name" autoComplete="off" value={r.name} error={errors["responsible.name"]} onChange={(e) => change("name", e.target.value)} />
          <TextField name="responsible.relationship" label="Relationship to patient" autoComplete="off" value={r.relationship} error={errors["responsible.relationship"]} onChange={(e) => change("relationship", e.target.value)} />
          <TextField name="responsible.idNumber" label="Synthetic identifier" autoComplete="off" placeholder="SYN-ID-20002" value={r.idNumber} error={errors["responsible.idNumber"]} onChange={(e) => change("idNumber", e.target.value)} />
          <TextField name="responsible.phone" label="Phone number" type="tel" autoComplete="off" value={r.phone} error={errors["responsible.phone"]} onChange={(e) => change("phone", e.target.value)} />
          <TextAreaField className="span-2" name="responsible.address" label="Address" autoComplete="off" value={r.address} error={errors["responsible.address"]} onChange={(e) => change("address", e.target.value)} />
        </div>
      )}
    </div>
  );
}

function StepPayer({ draft, errors, update, clearError }: StepProps) {
  const p = draft.payer;
  const change = (key: keyof OnboardingDraft["payer"], value: string) => {
    update("payer", { [key]: value } as Partial<OnboardingDraft["payer"]>);
    clearError(`payer.${key}`);
  };
  return (
    <div className="stack">
      <fieldset className="fieldset" aria-describedby={errors["payer.kind"] ? "payer-kind-error" : undefined}>
        <legend>How will the account be paid?</legend>
        <div className="choice-grid">
          <label className="choice">
            <input type="radio" name="payer.kind" id={fieldId("payer.kind")} checked={p.kind === "medical_aid"} onChange={() => change("kind", "medical_aid")} />
            <span><span className="choice__title">Medical aid</span><span className="choice__text">Scheme, membership number and plan</span></span>
          </label>
          <label className="choice">
            <input type="radio" name="payer.kind" checked={p.kind === "private"} onChange={() => change("kind", "private")} />
            <span><span className="choice__title">Private payer</span><span className="choice__text">No medical aid. Tracked as CASH.</span></span>
          </label>
        </div>
        {errors["payer.kind"] ? <FieldError id="payer-kind-error">{errors["payer.kind"]}</FieldError> : null}
      </fieldset>
      {p.kind === "medical_aid" ? (
        <div className="form-grid form-grid--2">
          <SelectField name="payer.scheme" label="Medical aid scheme (fictional)" value={p.scheme} error={errors["payer.scheme"]} onChange={(e) => change("scheme", e.target.value)}>
            <option value="">Choose a scheme…</option>
            {SCHEMES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </SelectField>
          <TextField name="payer.plan" label="Plan or option" autoComplete="off" value={p.plan} error={errors["payer.plan"]} onChange={(e) => change("plan", e.target.value)} />
          <TextField className="span-2" name="payer.membershipNumber" label="Membership number" autoComplete="off" placeholder="DHS-00000-X" value={p.membershipNumber} error={errors["payer.membershipNumber"]} onChange={(e) => change("membershipNumber", e.target.value)} />
        </div>
      ) : null}
    </div>
  );
}

function StepEmergency({ draft, errors, update, clearError }: StepProps) {
  const e = draft.emergency;
  const change = (key: keyof OnboardingDraft["emergency"], value: string) => {
    update("emergency", { [key]: value } as Partial<OnboardingDraft["emergency"]>);
    clearError(`emergency.${key}`);
  };
  return (
    <div className="form-grid form-grid--2">
      <TextField name="emergency.name" label="Contact name" autoComplete="off" value={e.name} error={errors["emergency.name"]} onChange={(ev) => change("name", ev.target.value)} />
      <TextField name="emergency.relationship" label="Relationship to patient" autoComplete="off" value={e.relationship} error={errors["emergency.relationship"]} onChange={(ev) => change("relationship", ev.target.value)} />
      <TextField name="emergency.phone" label="Phone number" type="tel" autoComplete="off" value={e.phone} error={errors["emergency.phone"]} onChange={(ev) => change("phone", ev.target.value)} />
      <TextField name="emergency.email" label="Email address" optional type="email" autoComplete="off" value={e.email} error={errors["emergency.email"]} onChange={(ev) => change("email", ev.target.value)} />
    </div>
  );
}

function StepReferral({ draft, errors, update, clearError }: StepProps) {
  const r = draft.referral;
  const change = (key: keyof OnboardingDraft["referral"], value: string) => {
    update("referral", { [key]: value } as Partial<OnboardingDraft["referral"]>);
    clearError(`referral.${key}`);
  };
  return (
    <div className="form-grid form-grid--2">
      <SelectField className="span-2" name="referral.source" label="Referred by" value={r.source} error={errors["referral.source"]} onChange={(e) => change("source", e.target.value)}>
        <option value="">Choose…</option>
        {REFERRAL_SOURCES.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </SelectField>
      {r.source && r.source !== "self" ? (
        <>
          <TextField name="referral.name" label="Referrer name" autoComplete="off" value={r.name} error={errors["referral.name"]} onChange={(e) => change("name", e.target.value)} />
          <TextField name="referral.phone" label="Referrer phone" type="tel" autoComplete="off" value={r.phone} error={errors["referral.phone"]} onChange={(e) => change("phone", e.target.value)} />
        </>
      ) : null}
      <TextAreaField className="span-2" name="referral.notes" label="Referral notes" optional value={r.notes} onChange={(e) => change("notes", e.target.value)} />
    </div>
  );
}

function StepDependants({ draft, errors, setDraft, clearError }: StepProps) {
  const input = draft.dependantInput;
  const [localErrors, setLocalErrors] = useState<FieldErrors>({});
  const shown = { ...errors, ...localErrors };
  const change = (key: keyof OnboardingDraft["dependantInput"], value: string) => {
    setDraft({ ...draft, dependantInput: { ...input, [key]: value } });
    setLocalErrors({});
    clearError(`dependantInput.${key}`);
    clearError("dependantInput.name");
  };
  const add = () => {
    const found = validateDependant(input);
    if (Object.keys(found).length) return setLocalErrors(found);
    setDraft({ ...draft, dependants: [...draft.dependants, { ...input }], dependantInput: emptyDependant() });
    setLocalErrors({});
  };
  return (
    <div className="stack">
      <p className="card__lead">Optional. Add each dependant who may be seen on this file, or continue if there are none.</p>
      {draft.dependants.length > 0 ? (
        <ul className="dependants" aria-label="Dependants added">
          {draft.dependants.map((d, i) => (
            <li key={`${d.code}-${i}`}>
              <span><strong>{d.name}</strong> · code {d.code} · born {formatDate(`${d.dateOfBirth}T00:00:00+02:00`)}</span>
              <Button size="sm" variant="ghost" icon="x" aria-label={`Remove dependant ${d.name}`} onClick={() => setDraft({ ...draft, dependants: draft.dependants.filter((_, idx) => idx !== i) })}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="form-grid form-grid--2 dependant-form">
        <TextField name="dependantInput.name" label="Dependant name" autoComplete="off" value={input.name} error={shown["dependantInput.name"]} onChange={(e) => change("name", e.target.value)} />
        <TextField name="dependantInput.dateOfBirth" label="Date of birth" type="date" max="2026-10-28" value={input.dateOfBirth} error={shown["dependantInput.dateOfBirth"]} onChange={(e) => change("dateOfBirth", e.target.value)} />
        <TextField name="dependantInput.code" label="Dependant code" autoComplete="off" placeholder="01" value={input.code} error={shown["dependantInput.code"]} onChange={(e) => change("code", e.target.value)} />
        <div className="field" style={{ justifyContent: "flex-end" }}>
          <Button icon="plus" onClick={add}>Add dependant</Button>
        </div>
      </div>
    </div>
  );
}

function Summary({ title, step, onEdit, children }: { title: string; step: number; onEdit: (step: number) => void; children: ReactNode }) {
  return (
    <section className="summary">
      <div className="summary__head">
        <h3>{title}</h3>
        <Button size="sm" variant="ghost" icon="pen" onClick={() => onEdit(step)} aria-label={`Edit ${title}`}>
          Edit
        </Button>
      </div>
      <p>{children}</p>
    </section>
  );
}

function StepReview({ draft, errors, update, clearError, onEdit }: StepProps & { onEdit: (step: number) => void }) {
  const p = draft.patient;
  const facility = p.facilityId ? facilityById(p.facilityId).name : "—";
  const change = (key: keyof OnboardingDraft["consent"], value: string | boolean) => {
    update("consent", { [key]: value } as Partial<OnboardingDraft["consent"]>);
    clearError(`consent.${key}`);
  };
  return (
    <div className="stack">
      <div className="summary-grid">
        <Summary title="Patient details" step={0} onEdit={onEdit}>
          {`${p.title} ${p.firstNames} ${p.surname} · ${p.idNumber} · born ${p.dateOfBirth || "—"} · ${facility}`}
        </Summary>
        <Summary title="Responsible party" step={1} onEdit={onEdit}>
          {draft.responsible.sameAsPatient ? "The patient" : `${draft.responsible.name} (${draft.responsible.relationship})`}
        </Summary>
        <Summary title="Medical aid or private payer" step={2} onEdit={onEdit}>
          {draft.payer.kind === "medical_aid" ? `${draft.payer.scheme}, ${draft.payer.plan}, ${draft.payer.membershipNumber}` : draft.payer.kind === "private" ? "Private payer (CASH)" : "—"}
        </Summary>
        <Summary title="Emergency contact" step={3} onEdit={onEdit}>
          {`${draft.emergency.name} (${draft.emergency.relationship}), ${draft.emergency.phone}`}
        </Summary>
        <Summary title="Referral information" step={4} onEdit={onEdit}>
          {draft.referral.source === "self" ? "Self-referred" : draft.referral.source ? `${draft.referral.name}, ${draft.referral.phone}` : "—"}
        </Summary>
        <Summary title="Dependants" step={5} onEdit={onEdit}>
          {draft.dependants.length ? draft.dependants.map((d) => d.name).join(", ") : "None"}
        </Summary>
      </div>

      <section className="consent card card--pad" aria-labelledby="consent-wording">
        <h3 id="consent-wording" className="card__title">Consent</h3>
        <p className="consent__text">
          <Badge tone="warn">Sample wording</Badge> I confirm that the information given is correct and I consent to my
          personal information being processed for my care and for practice administration. I understand my rights in
          respect of my personal information. Each practice supplies its own approved consent wording.
        </p>
        <label className="choice">
          <input type="checkbox" id={fieldId("consent.agreed")} checked={draft.consent.agreed} onChange={(e) => change("agreed", e.target.checked)} aria-describedby={errors["consent.agreed"] ? "consent-error" : undefined} />
          <span className="choice__title">The patient (or their guardian) agrees to the consent wording above</span>
        </label>
        {errors["consent.agreed"] ? <FieldError id="consent-error">{errors["consent.agreed"]}</FieldError> : null}
        <TextField name="consent.signedName" label="Typed signature (patient’s full name)" autoComplete="off" value={draft.consent.signedName} error={errors["consent.signedName"]} onChange={(e) => change("signedName", e.target.value)} />
      </section>
    </div>
  );
}

function BlockedPanel({ existing, onChange }: { existing: Patient; onChange: () => void }) {
  const { navigate } = useDemo();
  return (
    <div className="blocked" role="alert">
      <Callout tone="danger" icon="ban" title="Duplicate file blocked">
        A file already exists in this practice for that identifier:{" "}
        <strong>{patientListName(existing)}</strong> ({existing.fileNumber}). A second file for the same patient cannot be
        created. Open the existing file instead.
      </Callout>
      <div className="row mt">
        <Button variant="primary" icon="arrow-right" onClick={() => navigate({ scene: "patients", patientId: existing.id, tab: "overview" })}>
          Open the existing file
        </Button>
        <Button variant="ghost" onClick={onChange}>Change the identifier</Button>
      </div>
    </div>
  );
}

export function OnboardingScene() {
  const { model, act, navigate, announce } = useDemo();
  const draft = model.draft;
  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [duplicate, setDuplicate] = useState<Patient | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);

  // Clear any finished registration when leaving the section.
  useEffect(() => () => act({ type: "registration/clear" }), [act]);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  const registeredId = model.registration.status === "success" ? model.registration.patientId : null;
  useEffect(() => {
    if (!registeredId) return;
    const created = model.patients.find((p) => p.id === registeredId);
    if (created) announce(`Registration complete. File number ${created.fileNumber} generated.`);
  }, [registeredId, model.patients, announce]);

  const setDraft = (next: OnboardingDraft) => act({ type: "draft/set", draft: next });
  const update: StepProps["update"] = (section, patch) =>
    setDraft({ ...draft, [section]: { ...draft[section], ...patch } } as OnboardingDraft);
  const clearError = (key: string) =>
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const rest = { ...prev };
      delete rest[key];
      return rest;
    });

  const focusFirst = (found: FieldErrors) => {
    const key = Object.keys(found)[0];
    if (key) requestAnimationFrame(() => document.getElementById(fieldId(key))?.focus());
  };

  const goTo = (target: number) => {
    setErrors({});
    setDuplicate(null);
    setStep(target);
  };

  const next = () => {
    const found = validateStep(step, draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return focusFirst(found);
    if (step === 0) {
      const existing = findDuplicateByIdentity(model.patients, draft.patient.idType, draft.patient.idNumber);
      if (existing) {
        setDuplicate(existing);
        act({ type: "progress/mark", key: "duplicateBlocked" });
        return;
      }
    }
    setDuplicate(null);
    const target = step + 1;
    setFurthest(Math.max(furthest, target));
    setStep(target);
  };

  const submit = () => {
    const all = validateAll(draft);
    if (!all.valid && all.firstInvalidStep !== null) {
      const found = all.errors[all.firstInvalidStep] ?? {};
      setStep(all.firstInvalidStep);
      setErrors(found);
      announce(`Some details need attention on step ${all.firstInvalidStep + 1}: ${STEP_LABELS[all.firstInvalidStep]}.`);
      return focusFirst(found);
    }
    act({ type: "patient/register" });
  };

  const useSample = () => {
    setDraft(applySampleToStep(draft, step));
    setErrors({});
    setDuplicate(null);
  };

  const fillAll = () => {
    setDraft(sampleDraft());
    setErrors({});
    setDuplicate(null);
    setFurthest(STEP_COUNT - 1);
    setStep(STEP_COUNT - 1);
  };

  const startAnother = () => {
    act({ type: "registration/clear" });
    setStep(0);
    setFurthest(0);
    setErrors({});
    setDuplicate(null);
  };

  // ----- Result screens -----
  if (model.registration.status === "success") {
    const created = model.patients.find((p) => p.id === registeredId);
    return (
      <div className="stack-lg">
        <SceneHead eyebrow="Seven-step patient onboarding" title="Registration complete" />
        <section className="card card--pad success" aria-labelledby="success-title" role="status">
          <span className="success__icon" aria-hidden="true"><Icon name="check" /></span>
          <h2 id="success-title" className="success__title">Fictional patient registered</h2>
          {created ? (
            <>
              <p className="success__file">
                <span>File number</span>
                <strong className="mono" data-testid="new-file-number">{created.fileNumber}</strong>
              </p>
              <p className="success__text">
                {created.title} {created.firstNames} {created.surname} now appears in the in-memory register at{" "}
                {facilityById(created.facilityId).name}. This fictional record is discarded when you reload the page or
                reset the demo.
              </p>
            </>
          ) : null}
          <div className="row">
            <Button
              variant="primary"
              iconAfter="arrow-right"
              onClick={() => {
                if (!created) return;
                act({ type: "registration/clear" });
                navigate({ scene: "patients", patientId: created.id, tab: "overview" });
              }}
            >
              Open patient profile
            </Button>
            <Button
              icon="file"
              onClick={() => {
                if (!created) return;
                act({ type: "registration/clear" });
                navigate({ scene: "documents", patientId: created.id });
              }}
            >
              Attach documents
            </Button>
            <Button variant="ghost" icon="user-plus" onClick={startAnother}>Register another patient</Button>
          </div>
        </section>
      </div>
    );
  }

  if (model.registration.status === "blocked") {
    const existing = model.patients.find((p) => p.id === (model.registration.status === "blocked" ? model.registration.existingPatientId : ""));
    return (
      <div className="stack-lg">
        <SceneHead eyebrow="Seven-step patient onboarding" title="Registration blocked" />
        {existing ? <BlockedPanel existing={existing} onChange={startAnother} /> : null}
      </div>
    );
  }

  // ----- Wizard -----
  const props: StepProps = { draft, errors, update, setDraft, clearError };
  const isLast = step === STEP_COUNT - 1;

  return (
    <div className="stack-lg">
      <SceneHead
        eyebrow="Seven-step patient onboarding"
        title="Register a new patient"
        lead="Complete each section. Every step is checked before you continue, and the file is only created once everything is complete."
        actions={
          <Button icon="play" onClick={fillAll}>
            Fill all steps with sample data
          </Button>
        }
      />

      <Callout tone="warn" icon="alert">
        Please do not enter real patient information. Entries stay in this browser tab’s memory only, are never sent
        anywhere, and disappear when you reload. Use “Use sample data” for a quick, fictional example.
      </Callout>

      <nav aria-label="Onboarding progress">
        <ol className="stepper">
          {STEP_LABELS.map((label, index) => {
            // A step counts as done once the visitor has moved past it.
            const done = index < furthest;
            return (
              <li key={label} className={cx("stepper__item", index === step && "is-current", done && "is-done")}>
                <button
                  type="button"
                  className="stepper__btn"
                  disabled={index > furthest}
                  aria-current={index === step ? "step" : undefined}
                  onClick={() => goTo(index)}
                >
                  <span className="stepper__num" aria-hidden="true">{done ? <Icon name="check" /> : index + 1}</span>
                  <span className="stepper__label">{label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <section className="card card--pad wizard" aria-labelledby="step-title">
        <p className="wizard__progress" aria-live="polite">Step {step + 1} of {STEP_COUNT}</p>
        <div className="panel-head">
          <h2 id="step-title" className="wizard__title" ref={headingRef} tabIndex={-1}>{STEP_LABELS[step]}</h2>
          <Button size="sm" icon="pen" onClick={useSample}>Use sample data</Button>
        </div>

        {Object.keys(errors).length > 0 ? (
          <Callout tone="danger" icon="alert" role="alert" className="mt">
            Please correct {Object.keys(errors).length === 1 ? "the highlighted field" : `the ${Object.keys(errors).length} highlighted fields`} to continue.
          </Callout>
        ) : null}

        <div className="wizard__body">
          {step === 0 ? <StepPatient {...props} /> : null}
          {step === 1 ? <StepResponsible {...props} /> : null}
          {step === 2 ? <StepPayer {...props} /> : null}
          {step === 3 ? <StepEmergency {...props} /> : null}
          {step === 4 ? <StepReferral {...props} /> : null}
          {step === 5 ? <StepDependants {...props} /> : null}
          {step === 6 ? <StepReview {...props} onEdit={goTo} /> : null}
          {duplicate ? <BlockedPanel existing={duplicate} onChange={() => { setDuplicate(null); document.getElementById(fieldId("patient.idNumber"))?.focus(); }} /> : null}
        </div>

        <div className="wizard__nav">
          <Button icon="arrow-left" onClick={() => goTo(step - 1)} disabled={step === 0}>Previous</Button>
          {isLast ? (
            <Button variant="primary" icon="check" onClick={submit}>Complete registration</Button>
          ) : (
            <Button variant="primary" iconAfter="arrow-right" onClick={next}>Continue</Button>
          )}
        </div>
      </section>
    </div>
  );
}
