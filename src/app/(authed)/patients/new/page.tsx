import { resolveSession } from "@/lib/auth/session";
import { getPracticeSettings } from "@/lib/practice/settings";
import { redirect } from "next/navigation";
import { OnboardingWizard } from "./_components/onboarding-wizard";

export default async function NewPatientPage() {
  const session = await resolveSession();
  if (!session || !(session.role === "doctor" || session.role === "staff")) {
    // 404 for admin (§FR-2, §9).
    const { notFound } = await import("next/navigation");
    notFound();
  }

  // Reuse the same cached practice_settings read as the authenticated layout so
  // opening the onboarding flow does not add another /rest/v1/practice_settings
  // request on top of the layout/header read.
  type ConsentSettings = {
    active_consent_version?: string | null;
    active_consent_body?: string | null;
    privacy_notice_body?: string | null;
  };
  const settings = (await getPracticeSettings()) as ConsentSettings | null;

  if (!settings) redirect("/dashboard");

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">New patient onboarding</h1>
      <p className="text-text-secondary text-sm mb-6">
        Capture every section from the paper form. File number is generated on submit.
      </p>

      <OnboardingWizard
        consentVersion={settings.active_consent_version ?? ""}
        consentBody={settings.active_consent_body ?? ""}
        privacyNotice={settings.privacy_notice_body ?? ""}
      />
    </div>
  );
}
