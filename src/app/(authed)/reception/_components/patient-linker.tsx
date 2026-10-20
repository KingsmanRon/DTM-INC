"use client";

import { useEffect, useRef, useState } from "react";

type Patient = {
  id: string;
  file_number: string;
  first_names: string;
  surname: string;
  id_number: string;
};

export function PatientLinker({ onSelect }: { onSelect: (patient: Patient) => void }) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Patient[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }

    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/v1/patients/search?q=${encodeURIComponent(query.trim())}`, { credentials: "same-origin" });
        const json = await res.json();
        setResults(json.data ?? []);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  return (
    <div className="space-y-2">
      <label className="label" htmlFor="patient-search">Patient lookup</label>
      <input
        id="patient-search"
        className="input"
        placeholder="Search by file number, name, ID or phone"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {loading ? <p className="text-xs text-text-secondary">Searching patients…</p> : null}
      {results.length > 0 ? (
        <ul className="rounded border border-border-subtle divide-y divide-border-subtle bg-bg-primary max-h-56 overflow-auto">
          {results.map((patient) => (
            <li key={patient.id} className="px-3 py-2 flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">{patient.surname}, {patient.first_names}</p>
                <p className="text-xs text-text-secondary">{patient.file_number} · ID {patient.id_number}</p>
              </div>
              <button type="button" className="btn-secondary" onClick={() => onSelect(patient)}>
                Link
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
