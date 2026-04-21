import { notFound } from "next/navigation";
import { resolveSession } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const session = await resolveSession();
  if (!session || session.role !== "admin") notFound();

  const supabase = await getSupabaseServer();
  const { data } = await supabase.from("practice_settings").select("*").eq("id", 1).single();
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
