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

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch(`/api/v1/patients/${patientId}`, { credentials: "same-origin" });
      if (!res.ok) { if (alive) setLoading(false); return; }
      const json = await res.json();
      if (alive) { setData(json); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [patientId]);

  if (loading) return <p className="text-text-secondary text-sm">Loading…</p>;
  if (!data) return <p className="text-state-danger text-sm">Failed to load.</p>;

  return (
    <div className="space-y-4">
      <Block title="Patient">
        <KV k="Hospital" v={data.patient.hospital} />
        <KV k="Title" v={data.patient.title} />
        <KV k="Full name" v={`${data.patient.first_names} ${data.patient.surname}`} />
        <KV k="ID" v={data.patient.id_number} />
        <KV k="Email" v={data.patient.email} />
        <KV k="Phone" v={data.patient.phone} />
        <KV k="Address" v={data.patient.address} />
        <KV k="Payer type" v={data.patient.payer_type} />
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
