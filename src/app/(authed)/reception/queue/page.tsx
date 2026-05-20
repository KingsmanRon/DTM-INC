"use client";

import { useEffect, useMemo, useState } from "react";
import { OfflineSyncPanel } from "../_components/offline-sync-panel";

type QueueEntry = {
  id: string;
  queue_number: number;
  doctor_id: string;
  queue_date: string;
  queued_at: string;
  patient_id: string;
};

export default function ReceptionQueuePage() {
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10));
  const [queue, setQueue] = useState<QueueEntry[]>([]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/v1/queue/today", { cache: "no-store" });
      if (!res.ok) return;
      const payload = await res.json() as { queue?: QueueEntry[] };
      setQueue(payload.queue ?? []);
    })();
  }, []);

  const filtered = useMemo(() => queue.filter((item) => item.queue_date === dateFilter), [queue, dateFilter]);

  return (
    <div className="space-y-6">
      <OfflineSyncPanel />
      <section className="card space-y-4">
        <h1 className="section-title">Reception queue</h1>
        <input id="queue-date-filter" type="date" className="input" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
      </section>
      <section className="card">
        <h2 className="section-title mb-4">Queue numbers</h2>
        <div className="space-y-3">
          {filtered.map((entry) => (
            <article key={entry.id} className="rounded border border-border-subtle p-3 flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{entry.patient_id}</p>
                <p className="text-xs text-text-secondary">{entry.queue_date} · {entry.queued_at} · {entry.doctor_id}</p>
              </div>
              <div className="rounded bg-accent-teal/20 text-accent-teal px-3 py-1.5 font-mono text-lg">#{entry.queue_number}</div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
