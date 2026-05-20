"use client";

import { useMemo, useState } from "react";
import { OfflineSyncPanel } from "../_components/offline-sync-panel";
import { PatientLinker } from "../_components/patient-linker";

type AppointmentStatus = "scheduled" | "checked-in" | "completed" | "cancelled";

type Appointment = {
  id: string;
  time: string;
  date: string;
  doctor: string;
  reason: string;
  status: AppointmentStatus;
  patientName: string;
  patientFileNumber: string;
};

const doctors = ["All doctors", "Dr. Mtshali", "Dr. Moyo", "Dr. Naidoo"];

const initialAppointments: Appointment[] = [
  { id: "apt-001", time: "08:30", date: "2026-05-20", doctor: "Dr. Mtshali", reason: "Follow-up", status: "scheduled", patientName: "Nokuthula Maseko", patientFileNumber: "DTM-10021" },
  { id: "apt-002", time: "09:00", date: "2026-05-20", doctor: "Dr. Naidoo", reason: "Acute consult", status: "checked-in", patientName: "Sifiso Dlamini", patientFileNumber: "DTM-10007" },
  { id: "apt-003", time: "10:15", date: "2026-05-21", doctor: "Dr. Moyo", reason: "Lab review", status: "scheduled", patientName: "Ayanda Nkosi", patientFileNumber: "DTM-09984" },
];

function badge(status: AppointmentStatus) {
  if (status === "checked-in") return "bg-state-success/20 text-state-success";
  if (status === "completed") return "bg-accent-teal/20 text-accent-teal";
  if (status === "cancelled") return "bg-state-danger/20 text-state-danger";
  return "bg-state-warning/20 text-state-warning";
}

export default function ReceptionAppointmentsPage() {
  const [dateFilter, setDateFilter] = useState("2026-05-20");
  const [doctorFilter, setDoctorFilter] = useState(doctors[0]);
  const [appointments, setAppointments] = useState(initialAppointments);
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; first_names: string; surname: string; file_number: string } | null>(null);

  const filtered = useMemo(() => appointments.filter((item) => {
    const dateMatch = !dateFilter || item.date === dateFilter;
    const doctorMatch = doctorFilter === "All doctors" || item.doctor === doctorFilter;
    return dateMatch && doctorMatch;
  }), [appointments, dateFilter, doctorFilter]);

  const createAppointment = () => {
    if (!selectedPatient) return;
    setAppointments((prev) => [
      {
        id: `apt-${Math.random().toString(16).slice(2, 8)}`,
        time: "15:30",
        date: dateFilter || "2026-05-20",
        doctor: doctorFilter === "All doctors" ? "Dr. Mtshali" : doctorFilter,
        reason: "Reception booking",
        status: "scheduled",
        patientName: `${selectedPatient.surname}, ${selectedPatient.first_names}`,
        patientFileNumber: selectedPatient.file_number,
      },
      ...prev,
    ]);
  };

  const checkIn = (id: string) => {
    setAppointments((prev) => prev.map((item) => (item.id === id ? { ...item, status: "checked-in" } : item)));
  };

  return (
    <div className="space-y-6">
      <OfflineSyncPanel />

      <section className="card space-y-4">
        <h1 className="section-title">Reception appointments</h1>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="appointment-date-filter">Filter by date</label>
            <input id="appointment-date-filter" type="date" className="input" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="appointment-doctor-filter">Filter by doctor</label>
            <select id="appointment-doctor-filter" className="input" value={doctorFilter} onChange={(e) => setDoctorFilter(e.target.value)}>
              {doctors.map((doctor) => <option key={doctor}>{doctor}</option>)}
            </select>
          </div>
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="section-title">Create appointment</h2>
        <PatientLinker onSelect={setSelectedPatient} />
        {selectedPatient ? (
          <p className="text-sm text-text-secondary">Selected patient: <span className="text-text-primary">{selectedPatient.surname}, {selectedPatient.first_names}</span> ({selectedPatient.file_number})</p>
        ) : null}
        <div>
          <button type="button" className="btn-primary" onClick={createAppointment} disabled={!selectedPatient}>Create appointment</button>
        </div>
      </section>

      <section className="card">
        <h2 className="section-title mb-4">Appointment list</h2>
        <div className="space-y-3">
          {filtered.map((item) => (
            <article key={item.id} className="rounded border border-border-subtle p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{item.patientName}</p>
                  <p className="text-xs text-text-secondary">{item.patientFileNumber} · {item.reason}</p>
                </div>
                <span className={`px-2 py-0.5 text-xs rounded ${badge(item.status)}`}>{item.status}</span>
              </div>
              <div className="text-sm text-text-secondary">{item.date} · {item.time} · {item.doctor}</div>
              <button type="button" className="btn-secondary" onClick={() => checkIn(item.id)} disabled={item.status !== "scheduled"}>Check-in</button>
            </article>
          ))}
          {filtered.length === 0 ? <p className="text-sm text-text-secondary">No appointments for the selected filters.</p> : null}
        </div>
      </section>
    </div>
  );
}
