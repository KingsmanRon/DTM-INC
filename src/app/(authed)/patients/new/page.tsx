import { resolveSession } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { OnboardingWizard } from "./_components/onboarding-wizard";

export default async function NewPatientPage() {
  const session = await resolveSession();
  if (!session || !(session.role === "doctor" || session.role === "staff")) {
    // 404 for admin (§FR-2, §9).
    const { notFound } = await import("next/navigation");
    notFound();
  }

  const supabase = await getSupabaseServer();
  const { data: settings } = await supabase
    .from("practice_settings")
    .select("active_consent_version, active_consent_body, privacy_notice_body")
    .eq("id", 1)
    .single();

  if (!settings) redirect("/dashboard");

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">New patient onboarding</h1>
      <p className="text-text-secondary text-sm mb-6">
        Capture every section from the paper form. Drafts auto-save; file number is generated on submit.
      </p>

      <OnboardingWizard
        consentVersion={settings.active_consent_version}
        consentBody={settings.active_consent_body}
        privacyNotice={settings.privacy_notice_body}
      />
    </div>
  );
}
