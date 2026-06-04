import { notFound } from "next/navigation";
import { resolveSession } from "@/lib/auth/session";
import { getPracticeSettings } from "@/lib/practice/settings";

export default async function SettingsPage() {
  const session = await resolveSession();
  if (!session || session.role !== "admin") notFound();

  // Shared cached read — same source the header uses, so opening Settings does
  // not issue another /rest/v1/practice_settings query.
  type SettingsRow = {
    practice_name: string | null;
    practice_tagline: string | null;
    practice_number: string | null;
    doctor_name: string | null;
    doctor_qualifications: string | null;
    practice_address: string | null;
    practice_phone: string | null;
    file_number_format: string | null;
    active_consent_version: string | null;
    information_officer_name: string | null;
    information_officer_email: string | null;
  };
  const data = (await getPracticeSettings()) as SettingsRow | null;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Practice settings</h1>
      <p className="text-text-secondary text-sm">
        Read-only here for v1. PATCH /api/v1/admin/practice-settings from a small form.
      </p>
      <div className="card space-y-2 text-sm">
        <KV k="Practice name" v={data.practice_name} />
        <KV k="Tagline" v={data.practice_tagline} />
        <KV k="Practice number" v={data.practice_number} />
        <KV k="Doctor" v={`${data.doctor_name} — ${data.doctor_qualifications}`} />
        <KV k="Address" v={data.practice_address} />
        <KV k="Phone" v={data.practice_phone} />
        <KV k="File number format" v={data.file_number_format} />
        <KV k="Active consent version" v={data.active_consent_version} />
        <KV k="Information Officer" v={`${data.information_officer_name} · ${data.information_officer_email ?? "(no email)"}`} />
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex gap-3">
      <dt className="w-48 text-text-secondary">{k}</dt>
      <dd className="flex-1">{v || "—"}</dd>
    </div>
  );
}
