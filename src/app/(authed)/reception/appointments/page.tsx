"use client";

import { useEffect, useMemo, useState } from "react";
import { OfflineSyncPanel } from "../_components/offline-sync-panel";
import { PatientLinker } from "../_components/patient-linker";

type AppointmentStatus = "scheduled" | "confirmed" | "arrived" | "in_progress" | "completed" | "cancelled" | "no_show";

type Appointment = {
  id: string;
  scheduled_at: string;
  doctor_id: string;
  reason: string | null;
  status: AppointmentStatus;
  patient_id: string;
};

export default function ReceptionAppointmentsPage() {
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10));
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; first_names: string; surname: string; file_number: string } | null>(null);

  async function refresh() {
    const res = await fetch("/api/v1/appointments/today", { cache: "no-store" });
    if (!res.ok) return;
    const payload = await res.json() as { appointments?: Appointment[] };
    setAppointments(payload.appointments ?? []);
  }

  useEffect(() => { void refresh(); }, []);

  const filtered = useMemo(() => appointments.filter((item) => item.scheduled_at.slice(0, 10) === dateFilter), [appointments, dateFilter]);

  const createAppointment = async () => {
    if (!selectedPatient) return;
    const scheduledAt = new Date(`${dateFilter}T15:30:00.000Z`).toISOString();
    const doctors = appointments.map((a) => a.doctor_id).filter(Boolean);
    const doctor_id = doctors[0];
    if (!doctor_id) return;
    await fetch("/api/v1/appointments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patient_id: selectedPatient.id, doctor_id, scheduled_at: scheduledAt, reason: "Reception booking" }),
    });
    await refresh();
  };

  const checkIn = async (id: string) => {
    await fetch(`/api/v1/appointments/${id}/check-in`, { method: "POST" });
    await refresh();
  };

  return (
    <div className="space-y-6">
      <OfflineSyncPanel />
      <section className="card space-y-4">
        <h1 className="section-title">Reception appointments</h1>
        <input type="date" className="input" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
      </section>
      <section className="card space-y-4">
        <h2 className="section-title">Create appointment</h2>
        <PatientLinker onSelect={setSelectedPatient} />
        <button type="button" className="btn-primary" onClick={createAppointment} disabled={!selectedPatient}>Create appointment</button>
      </section>
      <section className="card">
        <h2 className="section-title mb-4">Appointment list</h2>
        <div className="space-y-3">
          {filtered.map((item) => (
            <article key={item.id} className="rounded border border-border-subtle p-3 space-y-2">
              <p className="font-semibold">{item.patient_id}</p>
              <div className="text-sm text-text-secondary">{item.scheduled_at} · {item.reason ?? "—"}</div>
              <span className="px-2 py-0.5 text-xs rounded bg-surface-muted">{item.status}</span>
              <button type="button" className="btn-secondary" onClick={() => checkIn(item.id)} disabled={item.status !== "scheduled"}>Check-in</button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
