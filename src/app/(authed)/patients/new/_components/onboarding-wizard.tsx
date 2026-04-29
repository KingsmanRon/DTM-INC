"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { dobFromSaId, isValidSaId } from "@/lib/validation/sa-id";

type Draft = {
  section_a: { title: string; first_names: string; surname: string; id_type: "sa_id" | "passport" | "other"; id_number: string; id_country?: string; email: string; phone: string; address: string };
  section_b: { same_as_patient: boolean; title: string; first_names: string; surname: string; id_number: string; date_of_birth: string; marital_status: string; email: string; phone: string; home_address: string; spouse_partner_phone: string; spouse_partner_work_phone: string; employer_name: string; occupation: string; work_address: string; work_phone: string };
  section_c: { same_as_responsible: boolean; main_member_name: string; medical_aid_name: string; membership_number: string; plan: string; other_plan_detail: string; is_private_payer: boolean };
  section_d: { name: string; relationship: string; address: string; email: string; phone: string };
  section_e: { referrer_type: "gp" | "specialist" | "hospital" | "self" | "other"; referrer_name: string; referrer_phone: string; referral_notes: string };
  dependants: Array<{ name: string; sex: "m" | "f" | "other"; date_of_birth: string; dependant_code: string; allergies: string }>;
  consent: { signature_type: "typed_name" | "drawn_signature"; signature_value: string; patient_present_attestation: boolean };
};

const emptyDraft: Draft = {
  section_a: { title: "Mr", first_names: "", surname: "", id_type: "sa_id", id_number: "", email: "", phone: "+27", address: "" },
  section_b: { same_as_patient: false, title: "Mr", first_names: "", surname: "", id_number: "", date_of_birth: "", marital_status: "single", email: "", phone: "+27", home_address: "", spouse_partner_phone: "", spouse_partner_work_phone: "", employer_name: "", occupation: "", work_address: "", work_phone: "" },
  section_c: { same_as_responsible: true, main_member_name: "", medical_aid_name: "", membership_number: "", plan: "", other_plan_detail: "", is_private_payer: false },
  section_d: { name: "", relationship: "", address: "", email: "", phone: "+27" },
  section_e: { referrer_type: "self", referrer_name: "", referrer_phone: "", referral_notes: "" },
  dependants: [],
  consent: { signature_type: "typed_name", signature_value: "", patient_present_attestation: false },
};

const STEPS = ["A — Patient", "B — Responsible", "C — Medical aid", "D — Emergency", "E — Referral", "F — Dependants", "G — Consent"] as const;
const CONSENT_SUMMARY_VERSION = "cards-v1";
const CONSENT_CARDS = [
  {
    badge: "A",
    title: "Treatment consent",
    body:
      "I consent to consultation, examination and treatment by Dr. Thomas Mtshali and to such investigations and procedures as may, in his clinical judgement, be reasonably necessary for my care. I understand that separate, specific consent will be obtained before any surgical or invasive procedure.",
  },
  {
    badge: "B",
    title: "Information processing under POPIA",
    body:
      "I authorise Dr. Thomas Mtshali Inc. (\"the Practice\") to collect, store, use and share my personal and health information for care, lawful record-keeping, and authorised administration. Under POPIA I have rights of access and correction, subject to lawful retention requirements.",
  },
  {
    badge: "C",
    title: "Financial terms",
    body:
      "I accept personal responsibility for payment of fees not covered by my medical aid, including co-payments and shortfalls. I acknowledge cancellation/no-show terms and understand outstanding accounts may proceed to lawful collections processes.",
  },
  {
    badge: "D",
    title: "Dependants (where applicable)",
    body:
      "Where I am the main member or legal guardian of any dependant whose details I provide, I confirm I am authorised to give the above consents on their behalf.",
  },
] as const;

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function OnboardingWizard(props: { consentVersion: string; consentBody: string; privacyNotice: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  // §FR-3 "Same as patient" shortcut
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
          date_of_birth: a.id_type === "sa_id" ? (dobFromSaId(a.id_number) ?? d.section_b.date_of_birth) : d.section_b.date_of_birth,
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

  async function onSubmit() {
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
      const res = await fetch("/api/v1/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Submit failed");
        if (body.issues) setIssues(body.issues.map((i: { path: string[]; message: string }) => `${i.path.join(".")}: ${i.message}`));
        return;
      }
      router.push(`/patients/${body.id}`);
    } finally {
      setBusy(false);
    }
  }

  const A = draft.section_a;
  const B = draft.section_b;
  const C = draft.section_c;
  const D = draft.section_d;
  const E = draft.section_e;

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-2">
        {STEPS.map((label, i) => (
          <button
            key={label}
            onClick={() => setStep(i)}
            className={`text-xs px-3 py-1.5 rounded border ${i === step ? "bg-accent-dtm-green border-accent-dtm-green text-white" : "border-border-subtle text-text-secondary hover:text-white"}`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="card space-y-4">
        {step === 0 && (
          <>
            <h2 className="section-title">A — Patient details</h2>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Title">
                <select className="input" value={A.title} onChange={(e) => setDraft({ ...draft, section_a: { ...A, title: e.target.value } })}>
                  {["Mr", "Mrs", "Miss", "Dr", "Prof", "Other"].map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="ID type">
                <select className="input" value={A.id_type} onChange={(e) => setDraft({ ...draft, section_a: { ...A, id_type: e.target.value as "sa_id" | "passport" | "other" } })}>
                  <option value="sa_id">SA ID</option>
                  <option value="passport">Passport</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="First names" required>
                <input className="input" value={A.first_names} onChange={(e) => setDraft({ ...draft, section_a: { ...A, first_names: e.target.value } })} />
              </Field>
              <Field label="Surname" required>
                <input className="input" value={A.surname} onChange={(e) => setDraft({ ...draft, section_a: { ...A, surname: e.target.value } })} />
              </Field>
              <Field label={A.id_type === "sa_id" ? "SA ID number" : A.id_type === "passport" ? "Passport number" : "ID number"} required error={saIdError ?? undefined}>
                <input className="input font-mono" value={A.id_number} onChange={(e) => setDraft({ ...draft, section_a: { ...A, id_number: e.target.value } })} />
              </Field>
              {A.id_type === "passport" && (
                <Field label="Country (ISO-2)" required>
                  <input className="input" maxLength={2} value={A.id_country ?? ""} onChange={(e) => setDraft({ ...draft, section_a: { ...A, id_country: e.target.value.toUpperCase() } })} />
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
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={B.same_as_patient} onChange={(e) => applySameAsPatient(e.target.checked)} />
              Same as patient
            </label>
            <div className="grid grid-cols-2 gap-4">
              <Field label="First names" required>
                <input className="input" value={B.first_names} onChange={(e) => setDraft({ ...draft, section_b: { ...B, first_names: e.target.value } })} />
              </Field>
              <Field label="Surname" required>
                <input className="input" value={B.surname} onChange={(e) => setDraft({ ...draft, section_b: { ...B, surname: e.target.value } })} />
              </Field>
              <Field label="ID number" required>
                <input className="input" value={B.id_number} onChange={(e) => setDraft({ ...draft, section_b: { ...B, id_number: e.target.value } })} />
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
              {(B.marital_status === "married" || B.marital_status === "partnered") ? (
                <>
                  <Field label="Spouse / Partner tel / cell">
                    <input className="input" value={B.spouse_partner_phone} onChange={(e) => setDraft({ ...draft, section_b: { ...B, spouse_partner_phone: e.target.value } })} />
                  </Field>
                  <Field label="Spouse / Partner work tel">
                    <input className="input" value={B.spouse_partner_work_phone} onChange={(e) => setDraft({ ...draft, section_b: { ...B, spouse_partner_work_phone: e.target.value } })} />
                  </Field>
                </>
              ) : null}
              <Field label="Employer"><input className="input" value={B.employer_name} onChange={(e) => setDraft({ ...draft, section_b: { ...B, employer_name: e.target.value } })} /></Field>
              <Field label="Occupation"><input className="input" value={B.occupation} onChange={(e) => setDraft({ ...draft, section_b: { ...B, occupation: e.target.value } })} /></Field>
              <Field label="Work address" full><input className="input" value={B.work_address} onChange={(e) => setDraft({ ...draft, section_b: { ...B, work_address: e.target.value } })} /></Field>
              <Field label="Work tel"><input className="input" value={B.work_phone} onChange={(e) => setDraft({ ...draft, section_b: { ...B, work_phone: e.target.value } })} /></Field>
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
                <div className="grid grid-cols-2 gap-4">
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
            <div className="grid grid-cols-2 gap-4">
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
            <div className="grid grid-cols-2 gap-4">
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
                  <Field label="Referrer name" required>
                    <input className="input" value={E.referrer_name} onChange={(e) => setDraft({ ...draft, section_e: { ...E, referrer_name: e.target.value } })} />
                  </Field>
                  <Field label="Referrer telephone" required>
                    <input className="input" value={E.referrer_phone} onChange={(e) => setDraft({ ...draft, section_e: { ...E, referrer_phone: e.target.value } })} />
                  </Field>
                </>
              )}
              <Field label="Referral notes" full>
                <textarea className="input" rows={2} value={E.referral_notes} onChange={(e) => setDraft({ ...draft, section_e: { ...E, referral_notes: e.target.value } })} />
              </Field>
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <h2 className="section-title">F — Dependants on medical aid</h2>
            <p className="text-xs text-text-secondary">Add one row per dependant. Zero dependants is fine.</p>
            <div className="space-y-3">
              {draft.dependants.map((dep, idx) => (
                <div key={idx} className="grid grid-cols-6 gap-2 items-end">
                  <Field label="Name"><input className="input" value={dep.name} onChange={(e) => {
                    const next = [...draft.dependants]; next[idx] = { ...dep, name: e.target.value }; setDraft({ ...draft, dependants: next });
                  }} /></Field>
                  <Field label="Sex">
                    <select className="input" value={dep.sex} onChange={(e) => {
                      const next = [...draft.dependants]; next[idx] = { ...dep, sex: e.target.value as "m" | "f" | "other" }; setDraft({ ...draft, dependants: next });
                    }}>
                      <option value="m">M</option><option value="f">F</option><option value="other">Other</option>
                    </select>
                  </Field>
                  <Field label="DOB"><input type="date" className="input" value={dep.date_of_birth} onChange={(e) => {
                    const next = [...draft.dependants]; next[idx] = { ...dep, date_of_birth: e.target.value }; setDraft({ ...draft, dependants: next });
                  }} /></Field>
                  <Field label="Code"><input className="input" value={dep.dependant_code} onChange={(e) => {
                    const next = [...draft.dependants]; next[idx] = { ...dep, dependant_code: e.target.value }; setDraft({ ...draft, dependants: next });
                  }} /></Field>
                  <Field label="Allergies"><input className="input" value={dep.allergies} onChange={(e) => {
                    const next = [...draft.dependants]; next[idx] = { ...dep, allergies: e.target.value }; setDraft({ ...draft, dependants: next });
                  }} /></Field>
                  <button className="btn-secondary" onClick={() => setDraft({ ...draft, dependants: draft.dependants.filter((_, i) => i !== idx) })}>Remove</button>
                </div>
              ))}
              <button className="btn-secondary" onClick={() => setDraft({ ...draft, dependants: [...draft.dependants, { name: "", sex: "f", date_of_birth: "", dependant_code: "", allergies: "" }] })}>
                Add dependant
              </button>
            </div>
          </>
        )}

        {step === 6 && (
          <div className="py-[28px] px-6">
            <div className="mb-[22px]">
              <h2 className="section-title">G — Consent and declaration</h2>
              <p className="text-sm text-text-secondary mt-1">
                Please review each statement, then capture signature and attestation to continue.
              </p>
            </div>

            {CONSENT_CARDS.map((card) => (
              <section key={card.badge} className="w-full rounded-[10px] px-[18px] py-4 mb-[10px] bg-bg-primary border border-border-subtle">
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

            <section className="w-full rounded-[10px] px-[18px] py-4 mb-[10px] bg-bg-primary border border-border-subtle">
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 shrink-0 rounded-full bg-accent-teal/20 text-accent-teal text-xs font-semibold grid place-items-center">
                  E
                </div>
                <div className="flex-1 space-y-3">
                  <h3 className="text-lg font-semibold">Declaration Confirmation</h3>
                  <div className="text-sm whitespace-pre-wrap text-text-secondary leading-7">
                    {props.consentBody || "(No consent text configured. Admin must populate practice_settings.active_consent_body before onboarding.)"}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
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

            <div className="mt-[22px] pt-[18px] border-t border-white/5 flex items-center gap-3">
              <button className="btn-secondary" onClick={() => setStep(Math.max(0, step - 1))}>Back</button>
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
          </div>
        )}

        <div className="flex justify-between pt-4 border-t border-border-subtle">
          <button className="btn-secondary" disabled={step === 0} onClick={() => setStep(Math.max(0, step - 1))}>Back</button>
          {step < STEPS.length - 1 ? (
            <button className="btn-secondary" onClick={() => setStep(Math.min(STEPS.length - 1, step + 1))}>Next</button>
          ) : <span />}
        </div>
      </div>
    </div>
  );
}

function Field(props: { label: string; required?: boolean; error?: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={props.full ? "col-span-2" : ""}>
      <label className="label">
        {props.label}{props.required ? <span className="text-state-danger"> *</span> : null}
      </label>
      {props.children}
      {props.error ? <p className="text-state-danger text-xs mt-1">{props.error}</p> : null}
    </div>
  );
}
