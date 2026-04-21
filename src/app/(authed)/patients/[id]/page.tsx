import { notFound } from "next/navigation";
import Link from "next/link";
import { resolveSession } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { PatientTabs } from "./_components/patient-tabs";

export default async function PatientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await resolveSession();
  if (!session) notFound();
  // Staff + doctor may view; admin sees 404 (§9).
  if (session.role === "admin") notFound();

  const { id } = await params;
  const supabase = await getSupabaseServer();

  const { data: patient, error } = await supabase.from("patients").select("*").eq("id", id).maybeSingle();
  if (error || !patient) notFound();

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
      <PatientTabs patientId={id} role={session.role} />
    </div>
  );
}
