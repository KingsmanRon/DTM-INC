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

const PRACTICES = [
  { prefix: "", label: "All practices" },
  { prefix: "NKA", label: "Nkanyezi Private Hospital" },
  { prefix: "FOU", label: "Fountain Private Hospital" },
  { prefix: "MED", label: "Mediclinic Vereeniging Hospital" },
  { prefix: "MID", label: "Midvaal Private Hospital" },
] as const;

export function PatientSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [prefix, setPrefix] = useState("");
  const [sort, setSort] = useState("updated_desc");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastFiredQuery = useRef<string | null>(null);

  useEffect(() => {
    const trimmed = q.trim();
    const requestKey = JSON.stringify({ q: trimmed, page, prefix, sort });

    if (timer.current) clearTimeout(timer.current);

    if (trimmed.length < 3 && !prefix) {
      abortRef.current?.abort();
      abortRef.current = null;
      lastFiredQuery.current = null;
      setResults([]);
      setHasMore(false);
      setLoading(false);
      return;
    }

    if (lastFiredQuery.current === requestKey) return;

    // §FR-5: debounced type-ahead, up to 10 matches. Keep this at 500ms so
    // intermediate terms such as "RA" do not storm PostgREST while typing.
    timer.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      lastFiredQuery.current = requestKey;
      setLoading(true);
      try {
        const params = new URLSearchParams({
          q: trimmed,
          page: String(page),
          pageSize: "10",
          sort,
        });
        if (prefix) params.set("prefix", prefix);
        const res = await fetch(`/api/v1/patients/search?${params.toString()}`, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        const json = await res.json();
        setResults(json.data ?? []);
        setHasMore(Boolean(json.hasMore));
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setResults([]);
          setHasMore(false);
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setLoading(false);
        }
      }
    }, 500);

    return () => {
      if (timer.current) clearTimeout(timer.current);
      // Abort any in-flight search as soon as the term/filter/page changes or
      // the component unmounts. Without this, a slow old request can keep a
      // PostgREST query alive until the next debounced request starts.
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
        lastFiredQuery.current = null;
      }
    };
  }, [q, page, prefix, sort]);

  useEffect(() => {
    setPage(1);
  }, [q, prefix, sort]);

  function getPracticeLabel(fileNumber: string): string {
    const code = fileNumber.split("-")[0] ?? "";
    return PRACTICES.find((p) => p.prefix === code)?.label ?? "Unknown practice";
  }

  return (
    <div className="space-y-2">
      <input
        autoFocus
        className="input text-lg"
        placeholder="Search file number, name, ID, phone…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <select className="input" value={prefix} onChange={(e) => setPrefix(e.target.value)}>
          {PRACTICES.map((p) => (
            <option key={p.label} value={p.prefix}>{p.label}</option>
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
        <ul className="bg-surface-elevated border border-border-subtle rounded-xl divide-y divide-border-subtle overflow-hidden shadow-sm">
          {results.map((r) => (
            <li key={r.id}>
              <Link href={`/patients/${r.id}`} prefetch={false} className="flex items-center justify-between px-4 py-3 hover:bg-bg-primary transition-colors">
                <div>
                  <div className="font-medium">{r.surname}, {r.first_names}</div>
                  <div className="text-xs text-text-secondary">
                    ID {r.id_number} · {r.phone} · {getPracticeLabel(r.file_number)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="file-number text-sm">{r.file_number}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {!loading && q.trim().length >= 3 && results.length === 0 ? (
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
