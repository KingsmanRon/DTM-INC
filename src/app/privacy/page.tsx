import { getSupabaseServer } from "@/lib/supabase/server";

export default async function PrivacyPage() {
  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from("practice_settings")
    .select("practice_name, practice_address, information_officer_name, information_officer_email, privacy_notice_body")
    .eq("id", 1)
    .maybeSingle();

  return (
    <main className="max-w-3xl mx-auto px-4 py-10 space-y-4">
      <h1 className="text-2xl font-semibold">Privacy notice</h1>
      <p className="text-text-secondary text-sm">
        {data?.practice_name ?? "Dr. Thomas Mtshali Inc."} processes health information in accordance with the Protection of Personal
        Information Act, 2013 (POPIA). Health information is treated as <em>special personal information</em>
        under POPIA sections 26–27.
      </p>

      <section className="card text-sm whitespace-pre-wrap">
        {data?.privacy_notice_body || "(Privacy notice body not yet configured. Admin: populate practice_settings.privacy_notice_body.)"}
      </section>

      <section className="card text-sm space-y-2">
        <h2 className="font-semibold">Information Officer</h2>
        <p>{data?.information_officer_name ?? "Dr. Thomas Mtshali"} (registered with the SA Information Regulator).</p>
        {data?.information_officer_email ? <p>Email: {data.information_officer_email}</p> : null}
        {data?.practice_address ? <p>Address: {data.practice_address}</p> : null}
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
