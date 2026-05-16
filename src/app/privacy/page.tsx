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

      <section className="card text-sm whitespace-pre-wrap">
        {data?.privacy_notice_body || "(Privacy notice body not yet configured. Admin: populate practice_settings.privacy_notice_body.)"}
      </section>

      <section className="card text-sm space-y-2">
        <h2 className="font-semibold">Information Officer</h2>
        <p>{data?.information_officer_name ?? "Dr. Thomas Mtshali"}</p>
        <p>Email: {data?.information_officer_email ?? "drmtshalitm@gmail.com"}</p>
        <p>Cell: 084 340 2177</p>
        <p>Address 1: {data?.practice_address ?? "Clinix Naledi-Nkanyezi Private Hospital, 1 Moshoeshoe Street, Sebokeng 1982"}</p>
        <p>Tel: 016 420-3160</p>
        <p>Address 2: The Fountain Private Hospital, R500 Annan Road, Between Carletonville &amp; Fochville</p>
        <p>Tel: 018 788-1285 / 1138</p>
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
