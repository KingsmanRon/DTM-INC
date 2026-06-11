import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { resolveSession } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getPatientBundle } from "@/lib/patients/bundle";
import { writeAudit } from "@/lib/audit/log";
import { PatientTabs } from "./_components/patient-tabs";
import { PrintCurrentFileButton } from "@/components/PrintCurrentFileButton";
import { canUseHandwrittenNotes, getHandwrittenNotesFeatures } from "@/lib/clinical-notes/features";

export default async function PatientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await resolveSession();
  if (!session) notFound();
  // Staff + doctor may view; admin sees 404 (§9).
  if (session.role === "admin") notFound();

  const { id } = await params;
  const supabase = await getSupabaseServer();

  const { data: bundle, error } = await getPatientBundle(supabase, id);
  if (error || !bundle) notFound();
  const { patient } = bundle;

  // POPIA access logging (review #22): opening the profile IS the access to
  // the demographics bundle — this server render fetches and displays it, so
  // the audit row is written here, not only on the API refresh path.
  const h = await headers();
  await writeAudit({
    actorUserId: session.userId,
    actorRole: session.role,
    action: "patient_view",
    entityType: "patient",
    entityId: id,
    patientId: id,
    metadata: { surface: "profile_page" },
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  });

  const isDoctor = session.role === "doctor";
  const inkEnabled = isDoctor && canUseHandwrittenNotes(session.userId);
  const features = getHandwrittenNotesFeatures();

  return (
    <div className="space-y-4">
      <header className="card flex items-center justify-between">
        <div>
          <div className="file-number text-lg">{patient.file_number}</div>
          <h1 className="text-2xl font-semibold">{patient.surname}, {patient.first_names}</h1>
          <p className="text-text-secondary text-sm">
            {patient.title} · ID {patient.id_number} · {patient.phone}
            {patient.status === "archived" ? <span className="ml-2 px-2 py-0.5 rounded bg-state-warning/20 text-state-warning text-xs">Archived</span> : null}
          </p>
        </div>
        <div className="flex gap-2">
          <PrintCurrentFileButton pdfHref={`/api/v1/patients/${id}/onboarding-pdf?disposition=inline`} />
          <Link
            href={`/api/v1/patients/${id}/onboarding-pdf`}
            className="btn-secondary"
            target="_blank"
            rel="noopener"
          >
            Download onboarding PDF
          </Link>
        </div>
      </header>

      {/* role is passed so the Clinical Notes tab only renders for doctors. */}
      <PatientTabs
        patientId={id}
        role={session.role}
        handwrittenNotesEnabled={inkEnabled}
        handwrittenFinaliseEnabled={inkEnabled && features.finaliseEnabled}
        notesPdfEnabled={isDoctor && features.pdfEnabled}
        initialDemographics={bundle}
      />
    </div>
  );
}
