"use client";

import { useEffect, useState } from "react";
import type { PatientBundle as PatientPayload } from "@/lib/patients/bundle";

export type HospitalOption = { name: string; file_prefix: string };

function formFromPayload(data: PatientPayload | null) {
  return {
    hospital: data?.patient.hospital ?? "",
    title: data?.patient.title ?? "",
    first_names: data?.patient.first_names ?? "",
    surname: data?.patient.surname ?? "",
    email: data?.patient.email ?? "",
    phone: data?.patient.phone ?? "",
    address: data?.patient.address ?? "",
    payer_type: data?.patient.payer_type ?? "",
    responsible_first_names: data?.responsible?.first_names ?? "",
    responsible_surname: data?.responsible?.surname ?? "",
    responsible_phone: data?.responsible?.phone ?? "",
    responsible_employer_name: data?.responsible?.employer_name ?? "",
    responsible_occupation: data?.responsible?.occupation ?? "",
    medical_main_member_name: data?.medical_aid?.main_member_name ?? "",
    medical_aid_name: data?.medical_aid?.medical_aid_name ?? "",
    medical_membership_number: data?.medical_aid?.membership_number ?? "",
    medical_plan: data?.medical_aid?.plan ?? "",
    contact_id: data?.contacts?.[0]?.id ?? "",
    contact_name: data?.contacts?.[0]?.name ?? "",
    contact_relationship: data?.contacts?.[0]?.relationship ?? "",
    contact_phone: data?.contacts?.[0]?.phone ?? "",
    referral_id: data?.referral?.id ?? "",
    referral_type: data?.referral?.referrer_type ?? "self",
    referral_name: data?.referral?.referrer_name ?? "",
    referral_phone: data?.referral?.referrer_phone ?? "",
  };
}

export function DemographicsTab({ patientId, initialData, hospitals }: { patientId: string; initialData: PatientPayload; hospitals: HospitalOption[] }) {
  const [data, setData] = useState<PatientPayload | null>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(() => formFromPayload(initialData));

  useEffect(() => {
    if (initialData?.patient.id === patientId) {
      setData(initialData);
      setForm(formFromPayload(initialData));
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    (async () => {
      setLoading(true);
      const res = await fetch(`/api/v1/patients/${patientId}`, {
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!res.ok) { setLoading(false); return; }
      const json = await res.json() as PatientPayload;
      setData(json);
      setForm(formFromPayload(json));
      setLoading(false);
    })().catch((err) => {
      if (!(err instanceof DOMException && err.name === "AbortError")) setLoading(false);
    });
    return () => controller.abort();
  }, [patientId, initialData]);

  if (loading) return <p className="text-text-secondary text-sm">Loading…</p>;
  if (!data) return <p className="text-state-danger text-sm">Failed to load.</p>;

  async function onSave() {
    if (!data) return;
    const current = data;
    setSaving(true);
    setError(null);
    // hospital is deliberately NOT sent: it is fixed at onboarding (the file
    // number carries its prefix) and the server rejects changes (0047).
    const payload = {
      title: form.title,
      first_names: form.first_names,
      surname: form.surname,
      email: form.email || null,
      phone: form.phone,
      address: form.address,
      // Omit rather than send "" — the server validates against the payer_type
      // enum and an empty string would fail the whole save.
      payer_type: form.payer_type || undefined,
      responsible: current.responsible ? {
        first_names: form.responsible_first_names,
        surname: form.responsible_surname,
        phone: form.responsible_phone,
        employer_name: form.responsible_employer_name || null,
        occupation: form.responsible_occupation || null,
      } : undefined,
      medical_aid: current.medical_aid ? {
        main_member_name: form.medical_main_member_name || null,
        medical_aid_name: form.medical_aid_name || null,
        membership_number: form.medical_membership_number || null,
        plan: form.medical_plan || null,
      } : undefined,
      contact: current.contacts[0] ? {
        id: form.contact_id || undefined,
        name: form.contact_name,
        relationship: form.contact_relationship,
        phone: form.contact_phone,
      } : undefined,
      referral: current.referral ? {
        id: form.referral_id || undefined,
        referrer_type: form.referral_type,
        referrer_name: form.referral_name || null,
        referrer_phone: form.referral_phone || null,
      } : undefined,
    };
    const res = await fetch(`/api/v1/patients/${patientId}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      setError("Failed to save changes.");
      setSaving(false);
      return;
    }
    const json = await res.json();
    setData((prev) => (prev ? { ...prev, patient: json.patient } : prev));
    setEditMode(false);
    setSaving(false);
  }

  return (
    <div className="space-y-4">
      <Block>
        <div className="mb-5 border-b border-border-subtle/70 pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-white">
                {`${data.patient.first_names ?? ""} ${data.patient.surname ?? ""}`.trim() || "Patient record"}
              </h2>
              <p className="mt-1 text-sm text-text-secondary">
                {data.patient.hospital || "Hospital not captured"}
              </p>
            </div>
            <div className="flex gap-2 sm:justify-end">
              {editMode ? (
                <>
                  <button className="btn-primary" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
                  <button className="btn-secondary" onClick={() => setEditMode(false)} disabled={saving}>Cancel</button>
                </>
              ) : (
                <button className="btn-secondary" onClick={() => setEditMode(true)}>Edit demographics</button>
              )}
            </div>
          </div>
        </div>
        {error ? <p className="mb-3 text-sm text-state-danger">{error}</p> : null}

        {editMode ? (
          <div className="space-y-6">
            <SectionHeading title="Personal information" />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Title" value={form.title} onChange={(v) => setForm((f) => ({ ...f, title: v }))} />
              <Field label="First names" value={form.first_names} onChange={(v) => setForm((f) => ({ ...f, first_names: v }))} />
              <Field label="Surname" value={form.surname} onChange={(v) => setForm((f) => ({ ...f, surname: v }))} />
              <Field label="Email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} />
              <Field label="Phone" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
              <Field label="Address" value={form.address} onChange={(v) => setForm((f) => ({ ...f, address: v }))} />
            </div>
            <SectionHeading title="Hospital information" />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {/* Hospital is fixed at onboarding — the file number carries its
                  prefix. Read-only here; moving a patient is an operator action. */}
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-secondary">Hospital (fixed at onboarding)</span>
                <input className="input bg-white/[0.02] opacity-60" value={form.hospital} disabled readOnly />
              </label>
              <SelectField
                label="Payer type"
                value={form.payer_type}
                onChange={(v) => setForm((f) => ({ ...f, payer_type: v }))}
                options={[
                  { value: "medical_aid", label: "Medical aid" },
                  { value: "private", label: "Private (cash)" },
                ]}
              />
            </div>
            {data.responsible ? (
              <>
                <SectionHeading title="Account-responsible party" />
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field label="First names" value={form.responsible_first_names} onChange={(v) => setForm((f) => ({ ...f, responsible_first_names: v }))} />
                  <Field label="Surname" value={form.responsible_surname} onChange={(v) => setForm((f) => ({ ...f, responsible_surname: v }))} />
                  <Field label="Phone" value={form.responsible_phone} onChange={(v) => setForm((f) => ({ ...f, responsible_phone: v }))} />
                  <Field label="Employer" value={form.responsible_employer_name} onChange={(v) => setForm((f) => ({ ...f, responsible_employer_name: v }))} />
                  <Field label="Occupation" value={form.responsible_occupation} onChange={(v) => setForm((f) => ({ ...f, responsible_occupation: v }))} />
                </div>
              </>
            ) : null}
            {data.medical_aid ? (
              <>
                <SectionHeading title="Medical aid" />
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field label="Main member" value={form.medical_main_member_name} onChange={(v) => setForm((f) => ({ ...f, medical_main_member_name: v }))} />
                  <Field label="Scheme" value={form.medical_aid_name} onChange={(v) => setForm((f) => ({ ...f, medical_aid_name: v }))} />
                  <Field label="Membership" value={form.medical_membership_number} onChange={(v) => setForm((f) => ({ ...f, medical_membership_number: v }))} />
                  <Field label="Plan" value={form.medical_plan} onChange={(v) => setForm((f) => ({ ...f, medical_plan: v }))} />
                </div>
              </>
            ) : null}
            {data.contacts[0] ? (
              <>
                <SectionHeading title="Emergency contact" />
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field label="Name" value={form.contact_name} onChange={(v) => setForm((f) => ({ ...f, contact_name: v }))} />
                  <Field label="Relationship" value={form.contact_relationship} onChange={(v) => setForm((f) => ({ ...f, contact_relationship: v }))} />
                  <Field label="Phone" value={form.contact_phone} onChange={(v) => setForm((f) => ({ ...f, contact_phone: v }))} />
                </div>
              </>
            ) : null}
            {data.referral ? (
              <>
                <SectionHeading title="Referral" />
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field label="Type" value={form.referral_type} onChange={(v) => setForm((f) => ({ ...f, referral_type: v }))} />
                  <Field label="Name" value={form.referral_name} onChange={(v) => setForm((f) => ({ ...f, referral_name: v }))} />
                  <Field label="Phone" value={form.referral_phone} onChange={(v) => setForm((f) => ({ ...f, referral_phone: v }))} />
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <div className="space-y-6">
            <SectionHeading title="Personal information" />
            <InfoGrid>
              <KV k="Title" v={data.patient.title} />
              <KV k="First names" v={data.patient.first_names} />
              <KV k="Surname" v={data.patient.surname} />
              <KV k="ID number" v={data.patient.id_number} />
              <KV k="Email" v={data.patient.email} />
              <KV k="Phone" v={data.patient.phone} />
              <KV k="Address" v={data.patient.address} />
            </InfoGrid>
            <SectionHeading title="Hospital information" />
            <InfoGrid>
              <KV k="Hospital" v={data.patient.hospital} />
              <KV k="Payer type" v={formatPayerType(data.patient.payer_type)} />
            </InfoGrid>
          </div>
        )}
      </Block>

      {!editMode ? (
        <>
          {data.responsible && (
            <Block title="Account-responsible party">
              <InfoGrid>
                <KV k="Name" v={`${data.responsible.first_names} ${data.responsible.surname}`} />
                <KV k="ID" v={data.responsible.id_number} />
                <KV k="Date of Birth" v={data.responsible.date_of_birth} />
                <KV k="Phone" v={data.responsible.phone} />
                <KV k="Employer" v={data.responsible.employer_name} />
                <KV k="Occupation" v={data.responsible.occupation} />
              </InfoGrid>
            </Block>
          )}

          {data.medical_aid && (
            <Block title="Medical aid">
              <InfoGrid>
                <KV k="Main member" v={data.medical_aid.main_member_name} />
                <KV k="Scheme" v={data.medical_aid.medical_aid_name} />
                <KV k="Membership" v={data.medical_aid.membership_number} />
                <KV k="Plan" v={data.medical_aid.plan} />
              </InfoGrid>
            </Block>
          )}

          {data.contacts[0] && (
            <Block title="Emergency contact">
              <InfoGrid>
                <KV k="Name" v={data.contacts[0].name} />
                <KV k="Relationship" v={data.contacts[0].relationship} />
                <KV k="Phone" v={data.contacts[0].phone} />
              </InfoGrid>
            </Block>
          )}

          {data.referral && (
            <Block title="Referral">
              <InfoGrid>
                <KV k="Type" v={formatReferralType(data.referral.referrer_type)} />
                <KV k="Name" v={data.referral.referrer_name} />
                <KV k="Phone" v={data.referral.referrer_phone} />
              </InfoGrid>
            </Block>
          )}

          {data.dependants.length > 0 && (
            <Block title="Dependants">
              <ul className="list-disc space-y-1 pl-5">
                {data.dependants.map((d, i) => (
                  <li key={i}>
                    {d.name || "Not captured"} · {d.sex || "Not captured"} · DOB {d.date_of_birth || "Not captured"} · Code {d.dependant_code || "Not captured"}
                  </li>
                ))}
              </ul>
            </Block>
          )}

          <ReassignHospitalCard
            patientId={patientId}
            currentHospital={data.patient.hospital ?? ""}
            currentFileNumber={data.patient.file_number ?? ""}
            hospitals={hospitals}
          />
        </>
      ) : null}
    </div>
  );
}

// Administrative correction for a patient filed under the WRONG hospital
// (0053): allocates a NEW file number under the correct prefix, retires the
// old one (still searchable), and removes never-exported billing rows from the
// wrong hospital's batch. Deliberately heavy on confirmation — the file number
// on the physical folder changes.
function ReassignHospitalCard({
  patientId,
  currentHospital,
  currentFileNumber,
  hospitals,
}: {
  patientId: string;
  currentHospital: string;
  currentFileNumber: string;
  hospitals: HospitalOption[];
}) {
  const [open, setOpen] = useState(false);
  const [newHospital, setNewHospital] = useState("");
  const [reason, setReason] = useState("");
  const [confirmNumber, setConfirmNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ new_file_number: string; new_hospital: string; removed_pending_billing: number } | null>(null);

  const otherHospitals = hospitals.filter((h) => h.name !== currentHospital);
  const reasonTooShort = reason.trim().length < 10;
  const confirmed = confirmNumber.trim() === currentFileNumber;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/patients/${patientId}/reassign-hospital`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ new_hospital: newHospital, reason: reason.trim() }),
      });
      const body = (await res.json().catch(() => null)) as
        | { message?: string; new_file_number?: string; new_hospital?: string; removed_pending_billing?: number }
        | null;
      if (!res.ok) {
        setError(body?.message ?? "Reassignment failed — please try again.");
        return;
      }
      setResult({
        new_file_number: body?.new_file_number ?? "",
        new_hospital: body?.new_hospital ?? newHospital,
        removed_pending_billing: body?.removed_pending_billing ?? 0,
      });
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Block title="Hospital reassignment complete">
        <div className="space-y-2 text-sm">
          <p>
            New file number: <span className="file-number font-semibold">{result.new_file_number}</span>{" "}
            at {result.new_hospital}. The old number ({currentFileNumber}) stays searchable and can
            never be issued to another patient.
          </p>
          {result.removed_pending_billing > 0 ? (
            <p className="text-state-warning text-xs">
              {result.removed_pending_billing} un-exported billing row(s) under the old hospital were
              removed — re-stage this patient in the correct hospital&rsquo;s batch if needed.
            </p>
          ) : null}
          <p className="text-xs text-text-secondary">
            Next: print the updated onboarding PDF and relabel the physical folder.
          </p>
          <button className="btn-primary" onClick={() => window.location.reload()}>
            Refresh to see the updated record
          </button>
        </div>
      </Block>
    );
  }

  return (
    <Block title="Administrative — wrong hospital?">
      {!open ? (
        <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-text-secondary">
            If this patient was onboarded under the wrong hospital, reassigning issues a NEW file
            number under the correct prefix. The old number is retired but stays searchable.
          </p>
          <button className="btn-secondary shrink-0" onClick={() => setOpen(true)} disabled={otherHospitals.length === 0}>
            Reassign hospital…
          </button>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-secondary">Correct hospital</span>
              <select className="input" value={newHospital} onChange={(e) => setNewHospital(e.target.value)} disabled={busy}>
                <option value="">Select…</option>
                {otherHospitals.map((h) => (
                  <option key={h.name} value={h.name}>{h.name} ({h.file_prefix})</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-secondary">
                Type the current file number to confirm ({currentFileNumber})
              </span>
              <input
                className="input font-mono"
                value={confirmNumber}
                onChange={(e) => setConfirmNumber(e.target.value)}
                placeholder={currentFileNumber}
                disabled={busy}
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-secondary">Reason (min 10 characters — recorded in the audit log)</span>
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Onboarded under Nkanyezi in error; patient is admitted at Fountain"
              disabled={busy}
            />
          </label>
          <p className="text-xs text-text-secondary">
            This issues a new file number immediately. Un-exported billing rows under the old
            hospital are removed; exported batches are untouched. The change is permanently audited.
          </p>
          {error ? <p className="text-state-danger text-xs">{error}</p> : null}
          <div className="flex gap-2">
            <button
              className="btn-primary"
              disabled={busy || !newHospital || reasonTooShort || !confirmed}
              onClick={submit}
            >
              {busy ? "Reassigning…" : "Reassign and issue new file number"}
            </button>
            <button className="btn-secondary" disabled={busy} onClick={() => { setOpen(false); setError(null); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </Block>
  );
}

function SectionHeading({ title }: { title: string }) {
  return <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">{title}</h3>;
}

function InfoGrid({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</dl>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-text-secondary">{label}</span>
      <input className="input bg-white/[0.02] transition-colors focus:bg-white/[0.04]" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-text-secondary">{label}</span>
      <select
        className="input bg-white/[0.02] transition-colors focus:bg-white/[0.04]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function formatReferralType(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v === "gp") return "GP";
  return v.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatPayerType(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v === "private") return "Private (cash)";
  if (v === "medical_aid") return "Medical aid";
  return v;
}

function Block({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="card border border-border-subtle/60 bg-white/[0.01] shadow-[0_10px_35px_rgba(0,0,0,0.25)]">
      {title ? <h3 className="mb-4 text-base font-semibold text-white">{title}</h3> : null}
      <div className="space-y-1 text-sm">{children}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div className="rounded-md border border-border-subtle/50 bg-white/[0.015] px-3 py-2">
      <dt className="mb-1 text-xs uppercase tracking-wide text-text-secondary">{k}</dt>
      <dd className="text-sm text-white">{v || <span className="text-text-secondary">Not captured</span>}</dd>
    </div>
  );
}
