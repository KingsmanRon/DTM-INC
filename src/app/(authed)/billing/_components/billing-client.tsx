"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CASH_PAYER_LABEL, billingFilename, monthLabel } from "@/lib/billing/format";
import type { BillingPayerType } from "@/lib/billing/rows";

// Hospitals come from the server page (public.hospitals via RLS, migration
// 0044) — the hardcoded list/prefix map is gone, so a new practice's hospitals
// appear here without a code change.
export type HospitalOption = { name: string; file_prefix: string };

type SearchResult = {
  id: string;
  file_number: string;
  first_names: string;
  surname: string;
  id_number: string;
  payer_type?: BillingPayerType | null;
};

type BatchItem = {
  id: string;
  patient_id: string;
  file_number: string | null;
  patient_name: string | null;
  id_number: string | null;
  medical_aid_number: string | null;
  payer_type: BillingPayerType | null;
  outgoing_date: string | null;
  returned_date: string | null;
  status: "pending" | "exported" | "returned";
  exported_at: string | null;
};

function currentMonthInput(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string; error?: string };
    return body.message ?? body.error ?? `Request failed (${res.status}).`;
  } catch {
    return `Request failed (${res.status}).`;
  }
}

export function BillingClient({ hospitals }: { hospitals: HospitalOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const hospital = useMemo(() => {
    const fromUrl = params.get("hospital");
    return hospitals.some((h) => h.name === fromUrl)
      ? (fromUrl as string)
      : hospitals[0]?.name ?? "";
  }, [params, hospitals]);

  const month = useMemo(() => {
    const fromUrl = params.get("month");
    return fromUrl && /^\d{4}-\d{2}$/.test(fromUrl) ? fromUrl : currentMonthInput();
  }, [params]);

  const prefix = hospitals.find((h) => h.name === hospital)?.file_prefix ?? "";

  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [loadingBatch, setLoadingBatch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [outgoingDate, setOutgoingDate] = useState("");
  const [busy, setBusy] = useState(false);

  // Candidate search (reuses /api/v1/patients/search — debounced, paginated).
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastFired = useRef<string | null>(null);

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      next.set("hospital", hospital);
      next.set("month", month);
      next.set(key, value);
      router.replace(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router, hospital, month],
  );

  const loadBatch = useCallback(async () => {
    setLoadingBatch(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/billing/batch?hospital=${encodeURIComponent(hospital)}&month=${encodeURIComponent(month)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setError(await readError(res));
        setBatch([]);
        return;
      }
      const body = (await res.json()) as { batch: BatchItem[] };
      setBatch(body.batch ?? []);
    } catch {
      setError("Could not load the batch. Please try again.");
    } finally {
      setLoadingBatch(false);
    }
  }, [hospital, month]);

  useEffect(() => {
    void loadBatch();
  }, [loadBatch]);

  // Reset to the first page of results when the term or hospital changes.
  useEffect(() => {
    setPage(1);
  }, [q, prefix]);

  // Debounced, abortable search scoped to the hospital's file-number prefix.
  // Empty term + prefix returns the hospital's roster (paginated), so staff can
  // browse or narrow — never the whole roster at once.
  useEffect(() => {
    const trimmed = q.trim();
    const key = JSON.stringify({ trimmed, page, prefix });
    if (timer.current) clearTimeout(timer.current);
    if (!prefix) {
      setResults([]);
      setHasMore(false);
      return;
    }
    if (lastFired.current === key) return;

    timer.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      lastFired.current = key;
      setSearching(true);
      try {
        const sp = new URLSearchParams({ prefix, page: String(page), pageSize: "10", sort: "updated_desc" });
        if (trimmed.length >= 3) sp.set("q", trimmed);
        const res = await fetch(`/api/v1/patients/search?${sp.toString()}`, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        const json = (await res.json()) as { data?: SearchResult[]; hasMore?: boolean };
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
          setSearching(false);
        }
      }
    }, 400);

    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
        lastFired.current = null;
      }
    };
  }, [q, page, prefix]);

  const batchIds = useMemo(() => new Set(batch.map((b) => b.patient_id)), [batch]);

  function toggle(patientId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(patientId)) next.delete(patientId);
      else next.add(patientId);
      return next;
    });
  }

  async function addSelected() {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/billing/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hospital, month, patient_ids: Array.from(selected) }),
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      setNotice(`Added ${selected.size} file(s) to the batch.`);
      setSelected(new Set());
      await loadBatch();
    } finally {
      setBusy(false);
    }
  }

  async function patchItem(id: string, payload: Record<string, string>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/billing/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      await loadBatch();
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/billing/items/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      await loadBatch();
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/billing/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hospital, month, outgoing_date: outgoingDate }),
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = billingFilename(hospital, month);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setNotice("Export downloaded. The batch is marked as exported.");
      await loadBatch();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Section 1 — selectors + the batch they build, together. */}
      <section className="card space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="hospital">Hospital</label>
            <select
              id="hospital"
              className="input"
              value={hospital}
              onChange={(e) => setParam("hospital", e.target.value)}
            >
              {hospitals.map((h) => (
                <option key={h.name} value={h.name}>{h.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="month">Month</label>
            <input
              id="month"
              type="month"
              className="input"
              value={month}
              onChange={(e) => setParam("month", e.target.value)}
            />
          </div>
        </div>

        {error ? <p className="text-state-danger text-sm">{error}</p> : null}
        {notice ? <p className="text-accent-teal text-sm">{notice}</p> : null}

        <div className="flex items-center justify-between border-t border-border-subtle pt-4">
          <h2 className="section-title">Batch — {monthLabel(month)}</h2>
          <span className="text-text-secondary text-xs">{batch.length} file(s) staged</span>
        </div>

        {loadingBatch ? (
          <p className="text-text-secondary text-sm">Loading…</p>
        ) : batch.length === 0 ? (
          <p className="text-text-secondary text-sm">No files staged yet. Search and add patients below.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="text-left text-text-secondary">
                  <th className="py-1 pr-3">Patient</th>
                  <th className="py-1 pr-3">File no.</th>
                  <th className="py-1 pr-3">ID / Passport</th>
                  <th className="py-1 pr-3">Medical aid</th>
                  <th className="py-1 pr-3">Returned date</th>
                  <th className="py-1 pr-3">Status</th>
                  <th className="py-1 pr-3" />
                </tr>
              </thead>
              <tbody>
                {batch.map((item) => (
                  <tr key={item.id} className="border-t border-border-subtle align-top">
                    <td className="py-2 pr-3 font-medium">{item.patient_name}</td>
                    <td className="py-2 pr-3">{item.file_number ?? "—"}</td>
                    <td className="py-2 pr-3">{item.id_number ?? "—"}</td>
                    <td className="py-2 pr-3"><MedicalAidCell item={item} /></td>
                    <td className="py-2 pr-3">
                      <input
                        type="date"
                        className="input py-1"
                        defaultValue={item.returned_date ?? ""}
                        disabled={busy}
                        onChange={(e) => patchItem(item.id, { returned_date: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pr-3 uppercase text-xs tracking-wide">{item.status}</td>
                    <td className="py-2 pr-3">
                      {item.status === "pending" ? (
                        <button
                          type="button"
                          className="text-state-danger hover:underline"
                          disabled={busy}
                          onClick={() => removeItem(item.id)}
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-border-subtle pt-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <label className="label" htmlFor="outgoing">Outgoing date (applied to the whole batch)</label>
            <input
              id="outgoing"
              type="date"
              className="input"
              value={outgoingDate}
              onChange={(e) => setOutgoingDate(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-primary w-full sm:w-auto"
            disabled={busy || batch.length === 0}
            onClick={generate}
          >
            Generate &amp; download .xlsx
          </button>
        </div>
      </section>

      {/* Section 2 — find and add patients (debounced server search). */}
      <section className="card space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="section-title">Add patients</h2>
          <button
            type="button"
            className="btn-secondary w-full sm:w-auto"
            disabled={busy || selected.size === 0}
            onClick={addSelected}
          >
            Add {selected.size > 0 ? `${selected.size} ` : ""}selected to batch
          </button>
        </div>

        <input
          className="input"
          placeholder="Search this hospital by name, file number, or ID…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        {searching ? <p className="text-xs text-text-secondary">Searching…</p> : null}

        {results.length === 0 && !searching ? (
          <p className="text-text-secondary text-sm">
            {q.trim().length > 0 ? "No matches in this hospital." : "Start typing to find patients, or browse the list."}
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {results.map((r) => {
              const inBatch = batchIds.has(r.id);
              return (
                <li key={r.id} className="flex items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    disabled={inBatch}
                    onChange={() => toggle(r.id)}
                    aria-label={`Select ${r.surname}, ${r.first_names}`}
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {r.surname}, {r.first_names}
                      {r.payer_type === "private" ? <CashBadge className="ml-2 align-middle" /> : null}
                    </p>
                    <p className="truncate text-xs text-text-secondary">
                      {r.file_number} · ID {r.id_number || "—"}
                    </p>
                  </div>
                  {inBatch ? (
                    <span className="ml-auto text-xs text-accent-teal">In batch</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {(results.length > 0 || page > 1) ? (
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              className="btn-secondary"
              disabled={page === 1 || searching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span className="text-xs text-text-secondary">Page {page}</span>
            <button
              type="button"
              className="btn-secondary"
              disabled={!hasMore || searching}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function CashBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block rounded bg-accent-teal/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-accent-teal ${className}`}
      title="Private payer — billed directly, no medical aid."
    >
      {CASH_PAYER_LABEL}
    </span>
  );
}

// Mirrors the export semantics in lib/billing/rows.ts (medicalAidCell): payer
// type is authoritative, so a private payer shows CASH even if a stale
// membership number was snapshotted. A medical-aid patient with no number is
// flagged so staff fix the record BEFORE the file goes out; legacy rows with
// an unknown payer keep the old "number or —" rendering.
function MedicalAidCell({ item }: { item: BatchItem }) {
  if (item.payer_type === "private") return <CashBadge />;
  if (item.medical_aid_number) return <>{item.medical_aid_number}</>;
  if (item.payer_type === "medical_aid") {
    return (
      <span
        className="inline-block rounded bg-state-warning/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-state-warning"
        title="No membership number captured. Fix it on the patient record, then re-add the patient to this batch to refresh the row. The export will not be blocked."
      >
        Missing
      </span>
    );
  }
  return <>—</>;
}
