"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { dobFromSaId, isValidSaId } from "@/lib/validation/sa-id";
import {
  DependantSchema,
  OnboardingPayload,
  SectionA,
  SectionB,
  SectionC,
  SectionD,
  SectionE,
  TitleEnum,
} from "@/lib/validation/patient";

export type ConsentCard = { badge: string; title: string; body: string };
export type HospitalOption = { name: string; file_prefix: string };

type Draft = {
  section_a: {
    hospital: string;
    is_minor: boolean;
    title: string;
    first_names: string;
    surname: string;
    id_type: "sa_id" | "passport" | "none_minor";
    id_number: string;
    id_country?: string;
    email: string;
    phone: string;
    address: string;
  };
  section_b: {
    same_as_patient: boolean;
    title: string;
    first_names: string;
    surname: string;
    id_number: string;
    date_of_birth: string;
    marital_status: string;
    email: string;
    phone: string;
    home_address: string;
    spouse_partner_phone: string;
    spouse_partner_work_phone: string;
    employer_name: string;
    occupation: string;
    work_address: string;
    work_phone: string;
  };
  section_c: {
    same_as_responsible: boolean;
    main_member_name: string;
    medical_aid_name: string;
    membership_number: string;
    plan: string;
    other_plan_detail: string;
    is_private_payer: boolean;
  };
  section_d: { name: string; relationship: string; address: string; email: string; phone: string };
  section_e: {
    referrer_type: "gp" | "specialist" | "hospital" | "self" | "other";
    referrer_name: string;
    referrer_phone: string;
    referral_notes: string;
  };
  dependants: Array<{
    name: string;
    sex: "m" | "f" | "other";
    date_of_birth: string;
    dependant_code: string;
    allergies: string;
  }>;
  consent: {
    signature_type: "typed_name" | "drawn_signature";
    signature_value: string;
    patient_present_attestation: boolean;
  };
};

const emptyDraft: Draft = {
  section_a: {
    hospital: "",
    is_minor: false,
    title: "Mr",
    first_names: "",
    surname: "",
    id_type: "sa_id",
    id_number: "",
    email: "",
    phone: "+27",
    address: "",
  },
  section_b: {
    same_as_patient: false,
    title: "Mr",
    first_names: "",
    surname: "",
    id_number: "",
    date_of_birth: "",
    marital_status: "single",
    email: "",
    phone: "+27",
    home_address: "",
    spouse_partner_phone: "",
    spouse_partner_work_phone: "",
    employer_name: "",
    occupation: "",
    work_address: "",
    work_phone: "",
  },
  section_c: {
    same_as_responsible: false,
    main_member_name: "",
    medical_aid_name: "",
    membership_number: "",
    plan: "",
    other_plan_detail: "",
    is_private_payer: false,
  },
  section_d: { name: "", relationship: "", address: "", email: "", phone: "+27" },
  section_e: { referrer_type: "self", referrer_name: "", referrer_phone: "", referral_notes: "" },
  dependants: [],
  consent: { signature_type: "typed_name", signature_value: "", patient_present_attestation: false },
};

const STEPS = [
  "A — Patient",
  "B — Responsible",
  "C — Medical aid",
  "D — Emergency",
  "E — Referral",
  "F — Dependants",
  "G — Consent",
] as const;

const CONSENT_SUMMARY_VERSION = "cards-v1";

// Drafts survive a refresh/navigation but NOT closing the tab: sessionStorage
// is per-tab and discarded with it, which is the right ceiling for PHI on a
// shared front-desk machine. Cleared on successful submit and by "Start over".
const DRAFT_STORAGE_KEY = "dtm.onboarding.draft.v1";

const ONBOARDING_ERROR_MESSAGES: Record<string, string> = {
  onboarding_failed: "We couldn’t save this patient. Please check required fields and try again.",
  validation_error:
    "Some details are missing or invalid. Please review the highlighted fields and try again.",
  stale_consent:
    "This consent version is no longer current. Refresh the page and review consent before submitting again.",
  duplicate_patient:
    "A patient with this ID number already exists. Search for and open the existing record instead of creating another file.",
  invalid_hospital: "Please select a valid hospital.",
};

// Fallback when practice_settings.consent_cards is empty (pre-0051 database).
// The live wording is data: see migration 0051 and the admin settings PATCH.
const FALLBACK_CONSENT_CARDS: ConsentCard[] = [
  {
    badge: "A",
    title: "Treatment consent",
    body: "I consent to consultation, examination and treatment by the practice and to such investigations and procedures as may, in the clinician's judgement, be reasonably necessary for my care. I understand that separate, specific consent will be obtained before any surgical or invasive procedure.",
  },
  {
    badge: "B",
    title: "Information processing under POPIA",
    body: "I authorise the Practice to collect, store, use and share my personal and health information for care, lawful record-keeping, and authorised administration. Under POPIA I have rights of access and correction, subject to lawful retention requirements.",
  },
  {
    badge: "C",
    title: "Financial terms",
    body: "I accept personal responsibility for payment of fees not covered by my medical aid, including co-payments and shortfalls. I acknowledge cancellation/no-show terms and understand outstanding accounts may proceed to lawful collections processes.",
  },
  {
    badge: "D",
    title: "Dependants (where applicable)",
    body: "Where I am the main member or legal guardian of any dependant whose details I provide, I confirm I am authorised to give the above consents on their behalf.",
  },
];

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// "section_a.first_names: Required" -> "First names: Required"
function humanizePath(path: Array<string | number>): string {
  const last = path[path.length - 1];
  if (last === undefined) return "";
  const label = String(last).replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function zodIssues(result: { success: boolean; error?: { issues: Array<{ path: Array<string | number>; message: string }> } }): string[] {
  if (result.success || !result.error) return [];
  return result.error.issues.map((i) => {
    const label = humanizePath(i.path);
    return label ? `${label}: ${i.message}` : i.message;
  });
}

export function OnboardingWizard(props: {
  consentVersion: string;
  consentBody: string;
  privacyNotice: string;
  consentCards: ConsentCard[];
  hospitals: HospitalOption[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => ({
    ...emptyDraft,
    section_a: { ...emptyDraft.section_a, hospital: props.hospitals[0]?.name ?? "" },
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [stepErrors, setStepErrors] = useState<string[]>([]);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const restoreDone = useRef(false);
  const submitInFlight = useRef(false);

  const consentCards = props.consentCards.length > 0 ? props.consentCards : FALLBACK_CONSENT_CARDS;

  // Restore an unsubmitted draft AFTER mount (not in the state initializer) so
  // server and client first-render markup match — no hydration mismatch.
  useEffect(() => {
    if (restoreDone.current) return;
    restoreDone.current = true;
    try {
      const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { version?: number; draft?: Draft } | null;
      if (parsed?.version === 1 && parsed.draft) {
        setDraft(parsed.draft);
        setRestoredDraft(true);
      }
    } catch {
      /* corrupt/absent draft — start clean */
    }
  }, []);

  // Persist on every change (a refresh mid-form used to destroy all 7 steps).
  useEffect(() => {
    if (!restoreDone.current) return;
    try {
      sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ version: 1, draft }));
    } catch {
      /* storage full/unavailable — the form still works, just without recovery */
    }
  }, [draft]);

  function clearStoredDraft() {
    try { sessionStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* ignore */ }
  }

  function startOver() {
    clearStoredDraft();
    setDraft({
      ...emptyDraft,
      section_a: { ...emptyDraft.section_a, hospital: props.hospitals[0]?.name ?? "" },
    });
    setStep(0);
    setStepErrors([]);
    setIssues([]);
    setError(null);
    setRestoredDraft(false);
  }

  function applySameAsPatient(value: boolean) {
    setDraft((d) => {
      if (!value) return { ...d, section_b: { ...d.section_b, same_as_patient: false } };
      const a = d.section_a;
      return {
        ...d,
        section_b: {
          ...d.section_b,
          same_as_patient: true,
          title: a.title,
          first_names: a.first_names,
          surname: a.surname,
          id_number: a.id_number,
          date_of_birth:
            a.id_type === "sa_id"
              ? (dobFromSaId(a.id_number) ?? d.section_b.date_of_birth)
              : d.section_b.date_of_birth,
          email: a.email,
          phone: a.phone,
          home_address: a.address,
        },
      };
    });
  }

  function applySameAsResponsible(value: boolean) {
    setDraft((d) => {
      if (!value) return { ...d, section_c: { ...d.section_c, same_as_responsible: false } };
      return {
        ...d,
        section_c: {
          ...d.section_c,
          same_as_responsible: true,
          main_member_name: `${d.section_b.first_names} ${d.section_b.surname}`.trim(),
        },
      };
    });
  }

  const saIdError = useMemo(() => {
    const v = draft.section_a;
    if (v.id_type === "sa_id" && v.id_number && !isValidSaId(v.id_number)) return "SA ID checksum failed.";
    return null;
  }, [draft.section_a]);

  // Guardian ID gets the same checksum scrutiny as the patient's — but as a
  // WARNING only: Section B has no id_type field, so a passport number that
  // happens to be 13 digits must not hard-block the form.
  const bIdWarning = useMemo(() => {
    const idNumber = draft.section_b.id_number.trim();
    if (/^\d{13}$/.test(idNumber) && !isValidSaId(idNumber)) {
      return "This looks like an SA ID number but its checksum fails — double-check before continuing.";
    }
    return null;
  }, [draft.section_b.id_number]);

  // Per-step validation (review #20): the SAME zod schemas the server enforces,
  // run when the user clicks Next — so a Section A typo surfaces on Section A,
  // not as a rejected submit after all seven steps.
  const stepValidators: Array<(d: Draft) => string[]> = [
    (d) => zodIssues(SectionA.safeParse(d.section_a)),
    (d) => zodIssues(SectionB.safeParse(d.section_b)),
    (d) => zodIssues(SectionC.safeParse(d.section_c)),
    (d) => zodIssues(SectionD.safeParse(d.section_d)),
    (d) => zodIssues(SectionE.safeParse(d.section_e)),
    (d) =>
      d.dependants.flatMap((dep, i) =>
        zodIssues(DependantSchema.safeParse(dep)).map((msg) => `Dependant ${i + 1} — ${msg}`)
      ),
  ];

  function goNext() {
    const validate = stepValidators[step];
    const errs = validate ? validate(draft) : [];
    if (errs.length > 0) {
      setStepErrors(errs);
      return;
    }
    setStepErrors([]);
    setStep(Math.min(STEPS.length - 1, step + 1));
  }

  function goBack() {
    setStepErrors([]);
    setStep(Math.max(0, step - 1));
  }

  function stepForPath(path: Array<string | number>): number {
    switch (path[0]) {
      case "section_a": return 0;
      case "section_b": return 1;
      case "section_c": return 2;
      case "section_d": return 3;
      case "section_e": return 4;
      case "dependants": return 5;
      default: return 6;
    }
  }

  async function onSubmit() {
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setError(null);
    setIssues([]);
    setBusy(true);
    try {
      const consent_text_hash = await sha256Hex(`${props.consentVersion}::${props.consentBody}`);
      const payload = {
        section_a: draft.section_a,
        section_b: draft.section_b,
        section_c: draft.section_c,
        section_d: draft.section_d,
        section_e: draft.section_e,
        dependants: draft.dependants,
        consent: {
          consent_text_version: props.consentVersion,
          consent_text_hash,
          consent_summary_version: CONSENT_SUMMARY_VERSION,
          signature_type: draft.consent.signature_type,
          signature_value: draft.consent.signature_value,
          patient_present_attestation: draft.consent.patient_present_attestation,
        },
      };

      // Full client-side validation BEFORE the network: same schema the server
      // runs, including the minor/guardian cross-section rules. On failure,
      // jump to the earliest offending section with its errors shown.
      const parsed = OnboardingPayload.safeParse(payload);
      if (!parsed.success) {
        const allIssues = parsed.error.issues;
        const firstStep = Math.min(...allIssues.map((i) => stepForPath(i.path)));
        const messages = allIssues.map((i) => {
          const label = humanizePath(i.path);
          return label ? `${label}: ${i.message}` : i.message;
        });
        if (firstStep < 6) {
          setStep(firstStep);
          setStepErrors(messages);
        } else {
          setIssues(messages);
        }
        return;
      }

      const res = await fetch("/api/v1/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        const errorCode = typeof body.error === "string" ? body.error : "";
        const existing = body.existing as { id?: string; file_number?: string } | undefined;
        setError(
          errorCode === "duplicate_patient" && existing?.file_number
            ? `A patient with this ID already exists as file ${existing.file_number}. Search for and open the existing record instead of creating another file.`
            : ONBOARDING_ERROR_MESSAGES[errorCode] ??
                body.message ??
                "We couldn’t submit this patient right now. Please try again."
        );
        if (body.issues) {
          setIssues(body.issues.map((i: { path: string[]; message: string }) => `${i.path.join(".")}: ${i.message}`));
        }
        return;
      }
      clearStoredDraft();
      router.push(`/patients/${body.id}`);
    } finally {
      submitInFlight.current = false;
      setBusy(false);
    }
  }

  const A = draft.section_a;
  const B = draft.section_b;
  const C = draft.section_c;
  const D = draft.section_d;
  const E = draft.section_e;

  if (props.hospitals.length === 0) {
    return (
      <div className="card">
        <p className="text-state-danger text-sm">
          No active hospitals are configured for this practice yet. An administrator must add
          hospitals (public.hospitals) before patients can be onboarded.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap items-center gap-2">
        {STEPS.map((label, i) => (
          <button
            key={label}
            onClick={() => { setStepErrors([]); setStep(i); }}
            className={`text-xs px-3 py-1.5 rounded border ${
              i === step
                ? "bg-accent-dtm-green border-accent-dtm-green text-white"
                : "border-border-subtle text-text-secondary hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={startOver}
          className="ml-auto text-xs px-3 py-1.5 rounded border border-border-subtle text-text-secondary hover:text-white"
        >
          Start over
        </button>
      </nav>

      {restoredDraft ? (
        <p className="text-xs text-text-secondary">
          Restored your unsubmitted draft from this session. Use “Start over” to discard it.
        </p>
      ) : null}

      <div className="card space-y-4">
        {stepErrors.length > 0 ? (
          <ul className="text-state-danger text-sm list-disc pl-5">
            {stepErrors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        ) : null}

        {step === 0 && (
          <>
            <h2 className="section-title">A — Patient details</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Hospital" required>
                <select
                  className="input"
                  value={A.hospital}
                  onChange={(e) => setDraft({ ...draft, section_a: { ...A, hospital: e.target.value } })}
                >
                  {props.hospitals.map((h) => (
                    <option key={h.name} value={h.name}>{h.name}</option>
                  ))}
                </select>
              </Field>

              <Field label="Title">
                <select className="input" value={A.title} onChange={(e) => setDraft({ ...draft, section_a: { ...A, title: e.target.value } })}>
                  {TitleEnum.options.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>

              <Field label="Under 18">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={A.is_minor}
                    onChange={(e) => {
                      const isMinor = e.target.checked;
                      setDraft({
                        ...draft,
                        section_a: {
                          ...A,
                          is_minor: isMinor,
                          id_type: isMinor ? "none_minor" : A.id_type === "none_minor" ? "sa_id" : A.id_type,
                          id_number: isMinor && A.id_type !== "none_minor" ? "" : A.id_number,
                          id_country: isMinor ? undefined : A.id_country,
                        },
                        section_b: { ...B, same_as_patient: isMinor ? false : B.same_as_patient },
                      });
                    }}
                  />
                  Patient is under 18 years old
                </label>
              </Field>

              <Field label="ID type">
                <select
                  className="input"
                  value={A.id_type}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      section_a: { ...A, id_type: e.target.value as "sa_id" | "passport" | "none_minor" },
                    })
                  }
                >
                  <option value="sa_id">SA ID</option>
                  <option value="passport">Passport</option>
                  {A.is_minor && <option value="none_minor">No ID yet (minor)</option>}
                </select>
              </Field>

              {A.is_minor && (
                <p className="col-span-2 text-xs text-text-secondary">
                  For minors without an SA ID or passport, choose “No ID yet (minor)”. Section B must contain the guardian or responsible party’s identity details.
                </p>
              )}

              <Field label="First names" required>
                <input className="input" value={A.first_names} onChange={(e) => setDraft({ ...draft, section_a: { ...A, first_names: e.target.value } })} />
              </Field>

              <Field label="Surname" required>
                <input className="input" value={A.surname} onChange={(e) => setDraft({ ...draft, section_a: { ...A, surname: e.target.value } })} />
              </Field>

              <Field
                label={A.id_type === "sa_id" ? "SA ID number" : A.id_type === "passport" ? "Passport number" : "Minor identifier / note"}
                required={A.id_type !== "none_minor"}
                error={saIdError ?? undefined}
              >
                <input className="input font-mono" value={A.id_number} onChange={(e) => setDraft({ ...draft, section_a: { ...A, id_number: e.target.value } })} />
              </Field>

              {A.id_type === "passport" && (
                <Field label="Country (ISO-2)" required>
                  <input
                    className="input"
                    maxLength={2}
                    value={A.id_country ?? ""}
                    onChange={(e) => setDraft({ ...draft, section_a: { ...A, id_country: e.target.value.toUpperCase() } })}
                  />
                </Field>
              )}

              <Field label="Email">
                <input type="email" className="input" value={A.email} onChange={(e) => setDraft({ ...draft, section_a: { ...A, email: e.target.value } })} />
              </Field>

              <Field label="Tel / Cell" required>
                <input className="input" value={A.phone} onChange={(e) => setDraft({ ...draft, section_a: { ...A, phone: e.target.value } })} />
              </Field>

              <Field label="Physical address" required full>
                <textarea className="input" rows={3} value={A.address} onChange={(e) => setDraft({ ...draft, section_a: { ...A, address: e.target.value } })} />
              </Field>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="section-title">B — Person responsible for account</h2>
            {A.is_minor && (
              <p className="text-xs text-text-secondary">
                Guardian/responsible-party details are required for minors. Capture full legal identity and contact information below.
              </p>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={B.same_as_patient} disabled={A.is_minor} onChange={(e) => applySameAsPatient(e.target.checked)} />
              Same as patient
            </label>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Title" required>
                <select className="input" value={B.title} onChange={(e) => setDraft({ ...draft, section_b: { ...B, title: e.target.value } })}>
                  {TitleEnum.options.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="First names" required>
                <input className="input" value={B.first_names} onChange={(e) => setDraft({ ...draft, section_b: { ...B, first_names: e.target.value } })} />
              </Field>
              <Field label="Surname" required>
                <input className="input" value={B.surname} onChange={(e) => setDraft({ ...draft, section_b: { ...B, surname: e.target.value } })} />
              </Field>
              <Field label="ID number" required error={undefined}>
                <input className="input" value={B.id_number} onChange={(e) => setDraft({ ...draft, section_b: { ...B, id_number: e.target.value } })} />
                {bIdWarning ? <p className="text-state-warning text-xs mt-1">{bIdWarning}</p> : null}
              </Field>
              <Field label="Date of birth" required>
                <input type="date" className="input" value={B.date_of_birth} onChange={(e) => setDraft({ ...draft, section_b: { ...B, date_of_birth: e.target.value } })} />
              </Field>
              <Field label="Marital status" required>
                <select className="input" value={B.marital_status} onChange={(e) => setDraft({ ...draft, section_b: { ...B, marital_status: e.target.value } })}>
                  <option value="single">Single</option>
                  <option value="married">Married</option>
                  <option value="divorced">Divorced</option>
                  <option value="widowed">Widowed</option>
                  <option value="partnered">Partnered</option>
                </select>
              </Field>
              <Field label="Tel / Cell" required>
                <input className="input" value={B.phone} onChange={(e) => setDraft({ ...draft, section_b: { ...B, phone: e.target.value } })} />
              </Field>
              <Field label="Home address" required full>
                <textarea className="input" rows={2} value={B.home_address} onChange={(e) => setDraft({ ...draft, section_b: { ...B, home_address: e.target.value } })} />
              </Field>
              {B.marital_status === "married" || B.marital_status === "partnered" ? (
                <>
                  <Field label="Spouse / Partner tel / cell">
                    <input className="input" value={B.spouse_partner_phone} onChange={(e) => setDraft({ ...draft, section_b: { ...B, spouse_partner_phone: e.target.value } })} />
                  </Field>
                  <Field label="Spouse / Partner work tel">
                    <input className="input" value={B.spouse_partner_work_phone} onChange={(e) => setDraft({ ...draft, section_b: { ...B, spouse_partner_work_phone: e.target.value } })} />
                  </Field>
                </>
              ) : null}
              <Field label="Employer">
                <input className="input" value={B.employer_name} onChange={(e) => setDraft({ ...draft, section_b: { ...B, employer_name: e.target.value } })} />
              </Field>
              <Field label="Occupation">
                <input className="input" value={B.occupation} onChange={(e) => setDraft({ ...draft, section_b: { ...B, occupation: e.target.value } })} />
              </Field>
              <Field label="Work address" full>
                <input className="input" value={B.work_address} onChange={(e) => setDraft({ ...draft, section_b: { ...B, work_address: e.target.value } })} />
              </Field>
              <Field label="Work tel">
                <input className="input" value={B.work_phone} onChange={(e) => setDraft({ ...draft, section_b: { ...B, work_phone: e.target.value } })} />
              </Field>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="section-title">C — Medical aid</h2>
            <p className="text-xs text-text-secondary">
              Medical aid information is stored for records and authorised third-party handoff only. Claims are processed outside this application.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={C.is_private_payer} onChange={(e) => setDraft({ ...draft, section_c: { ...C, is_private_payer: e.target.checked } })} />
              Private payer (no medical aid)
            </label>
            {!C.is_private_payer && (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={C.same_as_responsible} onChange={(e) => applySameAsResponsible(e.target.checked)} />
                  Main member is the account-responsible party
                </label>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field label="Main member full name" required>
                    <input className="input" value={C.main_member_name} onChange={(e) => setDraft({ ...draft, section_c: { ...C, main_member_name: e.target.value } })} />
                  </Field>
                  <Field label="Medical aid name" required>
                    <input className="input" value={C.medical_aid_name} onChange={(e) => setDraft({ ...draft, section_c: { ...C, medical_aid_name: e.target.value } })} placeholder="Type as patient states it (Discovery, Bonitas…)" />
                  </Field>
                  <Field label="Membership number" required>
                    <input className="input font-mono" value={C.membership_number} onChange={(e) => setDraft({ ...draft, section_c: { ...C, membership_number: e.target.value } })} />
                  </Field>
                  <Field label="Plan" required>
                    <input className="input" value={C.plan} onChange={(e) => setDraft({ ...draft, section_c: { ...C, plan: e.target.value } })} />
                  </Field>
                  <Field label="Other / hospital plan detail" full>
                    <input className="input" value={C.other_plan_detail} onChange={(e) => setDraft({ ...draft, section_c: { ...C, other_plan_detail: e.target.value } })} />
                  </Field>
                </div>
              </>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="section-title">D — Nearest family / friend</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Name" required><input className="input" value={D.name} onChange={(e) => setDraft({ ...draft, section_d: { ...D, name: e.target.value } })} /></Field>
              <Field label="Relationship" required><input className="input" value={D.relationship} onChange={(e) => setDraft({ ...draft, section_d: { ...D, relationship: e.target.value } })} /></Field>
              <Field label="Tel / Cell" required><input className="input" value={D.phone} onChange={(e) => setDraft({ ...draft, section_d: { ...D, phone: e.target.value } })} /></Field>
              <Field label="Email"><input type="email" className="input" value={D.email} onChange={(e) => setDraft({ ...draft, section_d: { ...D, email: e.target.value } })} /></Field>
              <Field label="Address" full><textarea className="input" rows={2} value={D.address} onChange={(e) => setDraft({ ...draft, section_d: { ...D, address: e.target.value } })} /></Field>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h2 className="section-title">E — Referred by</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Type" required>
                <select className="input" value={E.referrer_type} onChange={(e) => setDraft({ ...draft, section_e: { ...E, referrer_type: e.target.value as Draft["section_e"]["referrer_type"] } })}>
                  <option value="gp">GP</option>
                  <option value="specialist">Specialist</option>
                  <option value="hospital">Hospital</option>
                  <option value="self">Self-referred</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              {E.referrer_type !== "self" && (
                <>
                  <Field label="Referrer name" required><input className="input" value={E.referrer_name} onChange={(e) => setDraft({ ...draft, section_e: { ...E, referrer_name: e.target.value } })} /></Field>
                  <Field label="Referrer telephone" required><input className="input" value={E.referrer_phone} onChange={(e) => setDraft({ ...draft, section_e: { ...E, referrer_phone: e.target.value } })} /></Field>
                </>
              )}
              <Field label="Referral notes" full><textarea className="input" rows={2} value={E.referral_notes} onChange={(e) => setDraft({ ...draft, section_e: { ...E, referral_notes: e.target.value } })} /></Field>
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <h2 className="section-title">F — Dependants on medical aid</h2>
            <p className="text-xs text-text-secondary">Add one row per dependant. Zero dependants is fine.</p>
            <div className="space-y-3">
              {draft.dependants.map((dep, idx) => (
                <div key={idx} className="grid grid-cols-1 gap-2 rounded-lg border border-border-subtle p-3 sm:grid-cols-2 sm:items-end lg:grid-cols-6 lg:border-0 lg:p-0">
                  <Field label="Name">
                    <input className="input" value={dep.name} onChange={(e) => {
                      const next = [...draft.dependants];
                      next[idx] = { ...dep, name: e.target.value };
                      setDraft({ ...draft, dependants: next });
                    }} />
                  </Field>
                  <Field label="Sex">
                    <select className="input" value={dep.sex} onChange={(e) => {
                      const next = [...draft.dependants];
                      next[idx] = { ...dep, sex: e.target.value as "m" | "f" | "other" };
                      setDraft({ ...draft, dependants: next });
                    }}>
                      <option value="m">M</option>
                      <option value="f">F</option>
                      <option value="other">Other</option>
                    </select>
                  </Field>
                  <Field label="DOB">
                    <input type="date" className="input" value={dep.date_of_birth} onChange={(e) => {
                      const next = [...draft.dependants];
                      next[idx] = { ...dep, date_of_birth: e.target.value };
                      setDraft({ ...draft, dependants: next });
                    }} />
                  </Field>
                  <Field label="Code">
                    <input className="input" value={dep.dependant_code} onChange={(e) => {
                      const next = [...draft.dependants];
                      next[idx] = { ...dep, dependant_code: e.target.value };
                      setDraft({ ...draft, dependants: next });
                    }} />
                  </Field>
                  <Field label="Allergies">
                    <input className="input" value={dep.allergies} onChange={(e) => {
                      const next = [...draft.dependants];
                      next[idx] = { ...dep, allergies: e.target.value };
                      setDraft({ ...draft, dependants: next });
                    }} />
                  </Field>
                  <button className="btn-secondary sm:col-span-2 lg:col-span-1" onClick={() => setDraft({ ...draft, dependants: draft.dependants.filter((_, i) => i !== idx) })}>Remove</button>
                </div>
              ))}
              <button className="btn-secondary" onClick={() => setDraft({ ...draft, dependants: [...draft.dependants, { name: "", sex: "f", date_of_birth: "", dependant_code: "", allergies: "" }] })}>
                Add dependant
              </button>
            </div>
          </>
        )}

        {step === 6 && (
          <>
            <div>
              <h2 className="section-title">G — Consent and declaration</h2>
              <p className="text-sm text-text-secondary mt-1">
                Please review each statement, then capture signature and attestation to continue.
              </p>
            </div>

            <div className="space-y-3">
              {consentCards.map((card) => (
                <section key={card.badge} className="rounded-lg border border-border-subtle bg-bg-primary p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 shrink-0 rounded-full bg-accent-teal/20 text-accent-teal text-xs font-semibold grid place-items-center">
                      {card.badge}
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold mb-1">{card.title}</h3>
                      <p className="text-sm text-text-secondary leading-7">{card.body}</p>
                    </div>
                  </div>
                </section>
              ))}

              <section className="rounded-lg border border-border-subtle bg-bg-primary p-4">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 shrink-0 rounded-full bg-accent-teal/20 text-accent-teal text-xs font-semibold grid place-items-center">
                    E
                  </div>
                  <div className="flex-1 space-y-3">
                    <h3 className="text-lg font-semibold">Declaration Confirmation</h3>
                    <div className="text-sm whitespace-pre-wrap text-text-secondary leading-7">
                      {props.consentBody || "(No consent text configured. Admin must populate practice_settings.active_consent_body before onboarding.)"}
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <Field label="Signature (typed full name)" required>
                        <input className="input" value={draft.consent.signature_value} onChange={(e) => setDraft({ ...draft, consent: { ...draft.consent, signature_value: e.target.value } })} />
                      </Field>
                    </div>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" checked={draft.consent.patient_present_attestation} onChange={(e) => setDraft({ ...draft, consent: { ...draft.consent, patient_present_attestation: e.target.checked } })} />
                      <span>I attest the patient was physically present and consented to the above.</span>
                    </label>
                  </div>
                </div>
              </section>
            </div>

            <div className="flex items-center gap-3 border-t border-border-subtle pt-4">
              <button className="btn-secondary" onClick={goBack}>Back</button>
              <div className="flex-1">
                {error ? <p className="text-state-danger text-sm">{error}</p> : null}
                {issues.length > 0 ? (
                  <ul className="text-state-danger text-sm list-disc pl-5">
                    {issues.map((i) => <li key={i}>{i}</li>)}
                  </ul>
                ) : null}
              </div>
              <button className="btn-primary" onClick={onSubmit} disabled={busy || !draft.consent.patient_present_attestation || !draft.consent.signature_value}>
                {busy ? "Submitting…" : "Submit and generate file number"}
              </button>
            </div>
          </>
        )}

        {step < STEPS.length - 1 && (
          <div className="flex justify-between pt-4 border-t border-border-subtle">
            <button className="btn-secondary" disabled={step === 0} onClick={goBack}>Back</button>
            <button className="btn-secondary" onClick={goNext}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field(props: {
  label: string;
  required?: boolean;
  error?: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={props.full ? "md:col-span-2" : ""}>
      <label className="label">
        {props.label}
        {props.required ? <span className="text-state-danger"> *</span> : null}
      </label>
      {props.children}
      {props.error ? <p className="text-state-danger text-xs mt-1">{props.error}</p> : null}
    </div>
  );
}
