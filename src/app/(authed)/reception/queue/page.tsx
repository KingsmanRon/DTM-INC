"use client";

import { useMemo, useState } from "react";
import { OfflineSyncPanel } from "../_components/offline-sync-panel";

type QueueEntry = {
  id: string;
  queueNumber: string;
  patientName: string;
  doctor: string;
  date: string;
  checkedInAt: string;
};

const initialQueue: QueueEntry[] = [
  { id: "q-01", queueNumber: "A001", patientName: "Nokuthula Maseko", doctor: "Dr. Mtshali", date: "2026-05-20", checkedInAt: "08:25" },
  { id: "q-02", queueNumber: "A002", patientName: "Sifiso Dlamini", doctor: "Dr. Naidoo", date: "2026-05-20", checkedInAt: "08:54" },
  { id: "q-03", queueNumber: "B001", patientName: "Ayanda Nkosi", doctor: "Dr. Moyo", date: "2026-05-21", checkedInAt: "10:02" },
];

const doctors = ["All doctors", "Dr. Mtshali", "Dr. Moyo", "Dr. Naidoo"];

export default function ReceptionQueuePage() {
  const [dateFilter, setDateFilter] = useState("2026-05-20");
  const [doctorFilter, setDoctorFilter] = useState(doctors[0]);
  const [queue] = useState(initialQueue);

  const filtered = useMemo(() => queue.filter((item) => {
    const dateMatch = !dateFilter || item.date === dateFilter;
    const doctorMatch = doctorFilter === "All doctors" || item.doctor === doctorFilter;
    return dateMatch && doctorMatch;
  }), [queue, dateFilter, doctorFilter]);

  return (
    <div className="space-y-6">
      <OfflineSyncPanel />

      <section className="card space-y-4">
        <h1 className="section-title">Reception queue</h1>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="queue-date-filter">Filter by date</label>
            <input id="queue-date-filter" type="date" className="input" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="queue-doctor-filter">Filter by doctor</label>
            <select id="queue-doctor-filter" className="input" value={doctorFilter} onChange={(e) => setDoctorFilter(e.target.value)}>
              {doctors.map((doctor) => <option key={doctor}>{doctor}</option>)}
            </select>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="section-title mb-4">Queue numbers</h2>
        <div className="space-y-3">
          {filtered.map((entry) => (
            <article key={entry.id} className="rounded border border-border-subtle p-3 flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{entry.patientName}</p>
                <p className="text-xs text-text-secondary">{entry.date} · {entry.checkedInAt} · {entry.doctor}</p>
              </div>
              <div className="rounded bg-accent-teal/20 text-accent-teal px-3 py-1.5 font-mono text-lg">#{entry.queueNumber}</div>
            </article>
          ))}
          {filtered.length === 0 ? <p className="text-sm text-text-secondary">No queue entries for current filters.</p> : null}
        </div>
      </section>
    </div>
  );
}
