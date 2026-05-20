"use client";

import { useEffect, useState } from "react";
import { installOfflineReplayListener, writeWithOfflineQueue } from "@/lib/offline/queue";

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
    responsible_first_names: "",
    responsible_surname: "",
    responsible_phone: "",
    responsible_employer_name: "",
    responsible_occupation: "",
    medical_main_member_name: "",
    medical_aid_name: "",
    medical_membership_number: "",
    medical_plan: "",
    contact_id: "",
    contact_name: "",
    contact_relationship: "",
    contact_phone: "",
    referral_id: "",
    referral_type: "self",
    referral_name: "",
    referral_phone: "",
  });

  useEffect(() => installOfflineReplayListener(), []);

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
          responsible_first_names: json.responsible?.first_names ?? "",
          responsible_surname: json.responsible?.surname ?? "",
          responsible_phone: json.responsible?.phone ?? "",
          responsible_employer_name: json.responsible?.employer_name ?? "",
          responsible_occupation: json.responsible?.occupation ?? "",
          medical_main_member_name: json.medical_aid?.main_member_name ?? "",
          medical_aid_name: json.medical_aid?.medical_aid_name ?? "",
          medical_membership_number: json.medical_aid?.membership_number ?? "",
          medical_plan: json.medical_aid?.plan ?? "",
          contact_id: json.contacts?.[0]?.id ?? "",
          contact_name: json.contacts?.[0]?.name ?? "",
          contact_relationship: json.contacts?.[0]?.relationship ?? "",
          contact_phone: json.contacts?.[0]?.phone ?? "",
          referral_id: json.referral?.id ?? "",
          referral_type: json.referral?.referrer_type ?? "self",
          referral_name: json.referral?.referrer_name ?? "",
          referral_phone: json.referral?.referrer_phone ?? "",
        });
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [patientId]);

  if (loading) return <p className="text-text-secondary text-sm">Loading…</p>;
  if (!data) return <p className="text-state-danger text-sm">Failed to load.</p>;

  async function onSave() {
    if (!data) return;
    const current = data;
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
    const result = await writeWithOfflineQueue({
      actionType: "patient.update_basic",
      endpoint: `/api/v1/patients/${patientId}`,
      method: "PATCH",
      payload,
    });
    if (result.queued) {
      setError("Changes saved offline and will sync when online.");
      setSaving(false);
      setEditMode(false);
      return;
    }
    if (!result.response?.ok) {
      setError("Failed to save changes.");
      setSaving(false);
      return;
    }
    const json = await result.response.json();
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
              <Field label="Hospital" value={form.hospital} onChange={(v) => setForm((f) => ({ ...f, hospital: v }))} />
              <Field label="Payer type" value={form.payer_type} onChange={(v) => setForm((f) => ({ ...f, payer_type: v }))} />
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
              <KV k="Payer type" v={formatTitleCaseValue(data.patient.payer_type)} />
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
        </>
      ) : null}
    </div>
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

function formatReferralType(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v === "gp") return "GP";
  return v.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatTitleCaseValue(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());
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
