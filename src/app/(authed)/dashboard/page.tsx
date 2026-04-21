import Link from "next/link";
import { PatientSearch } from "./_components/patient-search";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold mb-1">Find a patient</h1>
        <p className="text-text-secondary text-sm mb-4">
          Search by file number, name, ID, phone, or medical aid number.
        </p>
        <PatientSearch />
      </section>

      <section className="card flex items-center justify-between">
        <div>
          <h2 className="section-title">Onboard a new patient</h2>
          <p className="text-text-secondary text-sm">
            Digital equivalent of the paper onboarding form. Generates a unique file number on submit.
          </p>
        </div>
        <Link href="/patients/new" className="btn-primary">New patient</Link>
      </section>
    </div>
  );
}
