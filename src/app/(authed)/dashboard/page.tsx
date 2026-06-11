import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getActiveHospitals } from "@/lib/hospitals";
import { PatientSearch } from "./_components/patient-search";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Hospitals are data (0044): fetched under the caller's RLS context so the
  // practice filter reflects whatever this deployment configured.
  const supabase = await getSupabaseServer();
  const hospitals = await getActiveHospitals(supabase);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold mb-1">Find a patient</h1>
        <p className="text-text-secondary text-sm mb-4">
          Search by file number, name, ID, phone, or medical aid number.
        </p>
        <PatientSearch hospitals={hospitals} />
      </section>

      <section className="card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="section-title">Onboard a new patient</h2>
          <p className="text-text-secondary text-sm">
            Digital equivalent of the paper onboarding form. Generates a unique file number on submit.
          </p>
        </div>
                <Link href="/patients/new" className="btn-primary w-full text-center sm:w-auto">
          New patient
        </Link>
      </section>
    </div>
  );
}
