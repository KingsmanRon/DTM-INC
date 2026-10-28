import { PRACTICE } from "@/app/demo/_interactive/fixtures/practice";
import { formatDate } from "@/app/demo/_interactive/kit/format";
import type { Patient, SampleDocumentTemplate } from "@/app/demo/_interactive/types";

/**
 * On-screen rendering of a bundled sample document. These are drawn in the
 * browser from the fictional patient record; they are not real files, and
 * the demonstration never accepts uploads.
 */
export function SampleDocument({ template, patient }: { template: SampleDocumentTemplate; patient?: Patient }) {
  const name = patient ? `${patient.title} ${patient.firstNames} ${patient.surname}` : "Sample Patient";
  const id = patient?.idNumber ?? "SYN-ID-00000";
  const file = patient?.fileNumber ?? `NTH-${PRACTICE.fileYear}-000000`;
  const dob = patient ? formatDate(`${patient.dateOfBirth}T00:00:00+02:00`) : "1 Jan 1980";

  return (
    <article className="paper" aria-label={`Preview of ${template.title}`}>
      <header className="paper__head">
        <strong>{PRACTICE.name}</strong>
        <span>Fictional letterhead · {PRACTICE.name}</span>
      </header>

      {template.category === "referral_letter" ? (
        <>
          <h3 className="paper__title">Referral letter</h3>
          <dl className="paper__facts">
            <div><dt>Date</dt><dd>27 Oct 2026</dd></div>
            <div><dt>To</dt><dd>Dr Sipho Example, {PRACTICE.name}</dd></div>
            <div><dt>Re</dt><dd>{name} · {file}</dd></div>
          </dl>
          <p>Dear Dr Example,</p>
          <p>
            Thank you for seeing {name}, who is referred for a consultation. A summary of the relevant background is
            provided on the attached sheet. Please contact the referring rooms if further information is needed.
          </p>
          <p className="paper__sign">Dr Example GP (fictional)<br />Sample Referring Rooms</p>
        </>
      ) : null}

      {template.category === "medical_aid_card" ? (
        <div className="paper__card">
          <span className="paper__card-brand">
            {patient?.payer.kind === "medical_aid" ? patient.payer.scheme : "Demo Health Scheme"}
          </span>
          <span className="paper__card-name">{name}</span>
          <span className="paper__card-row">
            <span>Membership</span>
            <strong className="mono">
              {patient?.payer.kind === "medical_aid" ? patient.payer.membershipNumber || "—" : "DHS-00000-X"}
            </strong>
          </span>
          <span className="paper__card-row">
            <span>Plan</span>
            <strong>{patient?.payer.kind === "medical_aid" ? patient.payer.plan : "Core Plan"}</strong>
          </span>
          <span className="paper__card-foot">SAMPLE CARD. NOT A REAL MEMBERSHIP.</span>
        </div>
      ) : null}

      {template.category === "id_copy" ? (
        <>
          <h3 className="paper__title">Identity document (sample)</h3>
          <div className="paper__id">
            <span className="paper__photo" aria-hidden="true" />
            <dl className="paper__facts">
              <div><dt>Name</dt><dd>{name}</dd></div>
              <div><dt>Date of birth</dt><dd>{dob}</dd></div>
              <div><dt>Synthetic identifier</dt><dd className="mono">{id}</dd></div>
            </dl>
          </div>
          <p className="paper__small">
            Uses a synthetic identifier. It is not a genuine identity document and is not verified against any
            government service.
          </p>
        </>
      ) : null}

      {template.category === "consent_form" ? (
        <>
          <h3 className="paper__title">Consent to treatment and information processing</h3>
          <p>
            Sample wording only. Each practice supplies its own approved consent text. I, {name}, confirm that the
            information I have provided is correct and I consent to my personal information being processed for my care
            and for practice administration.
          </p>
          <dl className="paper__facts">
            <div><dt>Signed by (typed)</dt><dd>{patient?.consent.signedName ?? name}</dd></div>
            <div><dt>Date</dt><dd>{patient ? formatDate(patient.consent.capturedAt) : "28 Oct 2026"}</dd></div>
            <div><dt>File</dt><dd className="mono">{file}</dd></div>
          </dl>
        </>
      ) : null}

      {template.category === "correspondence" ? (
        <>
          <h3 className="paper__title">Practice correspondence</h3>
          <dl className="paper__facts">
            <div><dt>Date</dt><dd>28 Oct 2026</dd></div>
            <div><dt>To</dt><dd>{name}</dd></div>
          </dl>
          <p>Dear {patient?.firstNames ?? "patient"},</p>
          <p>
            This is a fictional administrative letter confirming that your file has been updated. No action is required
            from you.
          </p>
          <p className="paper__sign">Reception, {PRACTICE.name}</p>
        </>
      ) : null}

      <footer className="paper__foot">
        {template.fileName} · {template.sizeLabel} · fictional demonstration document
      </footer>
    </article>
  );
}
