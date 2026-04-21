"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Result = {
  id: string;
  file_number: string;
  first_names: string;
  surname: string;
  id_number: string;
  phone: string;
  updated_at: string;
};

export function PatientSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults([]); return; }

    // §FR-5: 250ms debounce, type-ahead, up to 10 matches.
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/v1/patients/search?q=${encodeURIComponent(q.trim())}`, {
          credentials: "same-origin",
        });
        const json = await res.json();
        setResults(json.data ?? []);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  return (
    <div className="space-y-2">
      <input
        autoFocus
        className="input text-lg"
        placeholder="Search file number, name, ID, phone…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {loading ? <p className="text-xs text-text-secondary">Searching…</p> : null}

      {results.length > 0 ? (
        <ul className="bg-surface-elevated border border-border-subtle rounded divide-y divide-border-subtle">
          {results.map((r) => (
            <li key={r.id}>
              <Link
                href={`/patients/${r.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-bg-primary"
              >
                <div>
                  <div className="font-medium">{r.surname}, {r.first_names}</div>
                  <div className="text-xs text-text-secondary">
                    ID {r.id_number} · {r.phone}
                  </div>
                </div>
                <div className="file-number text-sm">{r.file_number}</div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {!loading && q.trim().length >= 2 && results.length === 0 ? (
        <p className="text-sm text-text-secondary">No matches.</p>
      ) : null}
    </div>
  );
}
