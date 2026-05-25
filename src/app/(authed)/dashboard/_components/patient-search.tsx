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
  hospital: string;
  updated_at: string;
};

const HOSPITALS = [
  "Nkanyezi Private Hospital",
  "Fountain Private Hospital",
  "Mediclinic Vereeniging Hospital",
  "Midvaal Private Hospital",
] as const;

export function PatientSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [prefix, setPrefix] = useState("");
  const [hospital, setHospital] = useState("");
  const [sort, setSort] = useState("updated_desc");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2 && !prefix && !hospital) { setResults([]); setHasMore(false); return; }

    // §FR-5: 250ms debounce, type-ahead, up to 10 matches.
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          q: q.trim(),
          page: String(page),
          pageSize: "10",
          sort,
        });
        if (prefix) params.set("prefix", prefix);
        if (hospital) params.set("hospital", hospital);
        const res = await fetch(`/api/v1/patients/search?${params.toString()}`, {
          credentials: "same-origin",
        });
        const json = await res.json();
        setResults(json.data ?? []);
        setHasMore(Boolean(json.hasMore));
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, page, prefix, hospital, sort]);

  useEffect(() => {
    setPage(1);
  }, [q, prefix, hospital, sort]);

  return (
    <div className="space-y-2">
      <input
        autoFocus
        className="input text-lg"
        placeholder="Search file number, name, ID, phone…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <select className="input" value={prefix} onChange={(e) => setPrefix(e.target.value)}>
          <option value="">All prefixes</option>
          <option value="NKA">NKA</option>
          <option value="FOU">FOU</option>
          <option value="MED">MED</option>
          <option value="MID">MID</option>
        </select>

        <select className="input" value={hospital} onChange={(e) => setHospital(e.target.value)}>
          <option value="">All hospitals</option>
          {HOSPITALS.map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </select>

        <select className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="updated_desc">Most recently updated</option>
          <option value="file_number_asc">File number (ascending)</option>
          <option value="file_number_desc">File number (descending)</option>
        </select>
      </div>

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
                    ID {r.id_number} · {r.phone} · {r.hospital}
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

      {(results.length > 0 || page > 1) ? (
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={page === 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <div className="text-xs text-text-secondary">Page {page}</div>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!hasMore || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
