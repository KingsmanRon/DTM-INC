"use client";

import { useEffect, useState } from "react";

type PatientPayload = {
  patient: Record<string, string | null>;
  responsible: Record<string, string | null> | null;
  medical_aid: Record<string, string | null> | null;
  contacts: Array<Record<string, string | null>>;
  referral: Record<string, string | null> | null;
  dependants: Array<Record<string, string | null>>;
};

export function DemographicsTab({ patientId }: { patientId: string }) {
  const [data, setData] = useState<PatientPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    hospital: "",
    title: "",
    first_names: "",
    surname: "",
    email: "",
    phone: "",
    address: "",
    payer_type: "",
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch(`/api/v1/patients/${patientId}`, { credentials: "same-origin" });
      if (!res.ok) { if (alive) setLoading(false); return; }
      const json = await res.json();
      if (alive) {
        setData(json);
        setForm({
          hospital: json.patient.hospital ?? "",
          title: json.patient.title ?? "",
          first_names: json.patient.first_names ?? "",
          surname: json.patient.surname ?? "",
          email: json.patient.email ?? "",
          phone: json.patient.phone ?? "",
          address: json.patient.address ?? "",
          payer_type: json.patient.payer_type ?? "",
        });
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [patientId]);

  if (loading) return <p className="text-text-secondary text-sm">Loading…</p>;
  if (!data) return <p className="text-state-danger text-sm">Failed to load.</p>;

  async function onSave() {
    setSaving(true);
    setError(null);
    const payload = {
      hospital: form.hospital,
      title: form.title,
      first_names: form.first_names,
      surname: form.surname,
      email: form.email || null,
      phone: form.phone,
      address: form.address,
      payer_type: form.payer_type,
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
      <Block title="Patient">
        <div className="mb-3 flex gap-2">
          {editMode ? (
            <>
              <button className="btn-primary" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
              <button className="btn-secondary" onClick={() => setEditMode(false)} disabled={saving}>Cancel</button>
            </>
          ) : (
            <button className="btn-secondary" onClick={() => setEditMode(true)}>Edit demographics</button>
          )}
        </div>
        {error ? <p className="mb-3 text-sm text-state-danger">{error}</p> : null}

        {editMode ? (
          <div className="space-y-3">
            <Field label="Hospital" value={form.hospital} onChange={(v) => setForm((f) => ({ ...f, hospital: v }))} />
            <Field label="Title" value={form.title} onChange={(v) => setForm((f) => ({ ...f, title: v }))} />
            <Field label="First names" value={form.first_names} onChange={(v) => setForm((f) => ({ ...f, first_names: v }))} />
            <Field label="Surname" value={form.surname} onChange={(v) => setForm((f) => ({ ...f, surname: v }))} />
            <Field label="Email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} />
            <Field label="Phone" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
            <Field label="Address" value={form.address} onChange={(v) => setForm((f) => ({ ...f, address: v }))} />
            <Field label="Payer type" value={form.payer_type} onChange={(v) => setForm((f) => ({ ...f, payer_type: v }))} />
          </div>
        ) : (
          <>
            <KV k="Hospital" v={data.patient.hospital} />
            <KV k="Title" v={data.patient.title} />
            <KV k="Full name" v={`${data.patient.first_names} ${data.patient.surname}`} />
            <KV k="Email" v={data.patient.email} />
            <KV k="Phone" v={data.patient.phone} />
            <KV k="Address" v={data.patient.address} />
            <KV k="Payer type" v={data.patient.payer_type} />
          </>
        )}
        <KV k="ID" v={data.patient.id_number} />
      </Block>

      {data.responsible && (
        <Block title="Account-responsible party">
          <KV k="Name" v={`${data.responsible.first_names} ${data.responsible.surname}`} />
          <KV k="ID" v={data.responsible.id_number} />
          <KV k="DOB" v={data.responsible.date_of_birth} />
          <KV k="Phone" v={data.responsible.phone} />
          <KV k="Employer" v={data.responsible.employer_name} />
          <KV k="Occupation" v={data.responsible.occupation} />
        </Block>
      )}

      {data.medical_aid && (
        <Block title="Medical aid">
          <KV k="Main member" v={data.medical_aid.main_member_name} />
          <KV k="Scheme" v={data.medical_aid.medical_aid_name} />
          <KV k="Membership" v={data.medical_aid.membership_number} />
          <KV k="Plan" v={data.medical_aid.plan} />
        </Block>
      )}

      {data.contacts[0] && (
        <Block title="Emergency contact">
          <KV k="Name" v={data.contacts[0].name} />
          <KV k="Relationship" v={data.contacts[0].relationship} />
          <KV k="Phone" v={data.contacts[0].phone} />
        </Block>
      )}

      {data.referral && (
        <Block title="Referral">
          <KV k="Type" v={data.referral.referrer_type} />
          <KV k="Name" v={data.referral.referrer_name} />
          <KV k="Phone" v={data.referral.referrer_phone} />
        </Block>
      )}

      {data.dependants.length > 0 && (
        <Block title="Dependants">
          <ul className="list-disc pl-5">
            {data.dependants.map((d, i) => (
              <li key={i}>
                {d.name} · {d.sex} · DOB {d.date_of_birth} · Code {d.dependant_code}
              </li>
            ))}
          </ul>
        </Block>
      )}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-text-secondary">{label}</span>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h3 className="section-title mb-3">{title}</h3>
      <div className="space-y-1 text-sm">{children}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div className="flex gap-3">
      <dt className="w-40 text-text-secondary">{k}</dt>
      <dd className="flex-1">{v || <span className="text-text-secondary">—</span>}</dd>
    </div>
  );
}
