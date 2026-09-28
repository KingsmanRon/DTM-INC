import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  // Public, explicitly projected practice contact data only. Never PHI.
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("practice_settings")
    .select("practice_name, practice_address, practice_phone, information_officer_name, information_officer_email, privacy_notice_body")
    .eq("id", 1)
    .maybeSingle();

  return (
    <main className="max-w-3xl mx-auto px-4 py-10 space-y-4">
      <h1 className="text-2xl font-semibold">Privacy notice</h1>

      <section className="card text-sm whitespace-pre-wrap">
        {data?.privacy_notice_body || "(Privacy notice body not yet configured. Admin: populate practice_settings.privacy_notice_body.)"}
      </section>

      <section className="card text-sm space-y-2">
        <h2 className="font-semibold">Information Officer</h2>
        <p>{data?.information_officer_name ?? "Contact the practice"}</p>
        <p>Email: {data?.information_officer_email ?? "Contact the practice"}</p>
        <p>Address: {data?.practice_address ?? "Contact the practice"}</p>
        <p>Tel: {data?.practice_phone ?? "Contact the practice"}</p>
      </section>

      <section className="card text-sm space-y-2">
        <h2 className="font-semibold">Your rights</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Right of access to your personal information held by the practice.</li>
          <li>Right to request correction of inaccurate information.</li>
          <li>Right to request deletion where legally permissible (subject to HPCSA retention rules).</li>
          <li>Right to object to processing in certain circumstances.</li>
          <li>Right to lodge a complaint with the Information Regulator.</li>
        </ul>
      </section>
    </main>
  );
}
