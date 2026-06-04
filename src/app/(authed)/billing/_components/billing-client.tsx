"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BILLING_HOSPITALS, billingFilename, monthLabel } from "@/lib/billing/format";

type Candidate = {
  patient_id: string;
  file_number: string | null;
  name: string;
  id_number: string | null;
  id_type: string | null;
  medical_aid_number: string | null;
  in_batch: boolean;
};

type BatchItem = {
  id: string;
  patient_id: string;
  file_number: string | null;
  patient_name: string | null;
  id_number: string | null;
  medical_aid_number: string | null;
  outgoing_date: string | null;
  returned_date: string | null;
  status: "pending" | "exported" | "returned";
  exported_at: string | null;
};

type CandidatesResponse = {
  hospital: string;
  month: string;
  candidates: Candidate[];
  batch: BatchItem[];
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

export function BillingClient() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const hospital = useMemo(() => {
    const fromUrl = params.get("hospital");
    return BILLING_HOSPITALS.includes(fromUrl as (typeof BILLING_HOSPITALS)[number])
      ? (fromUrl as string)
      : BILLING_HOSPITALS[0];
  }, [params]);

  const month = useMemo(() => {
    const fromUrl = params.get("month");
    return fromUrl && /^\d{4}-\d{2}$/.test(fromUrl) ? fromUrl : currentMonthInput();
  }, [params]);

  const [data, setData] = useState<CandidatesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [outgoingDate, setOutgoingDate] = useState("");
  const [busy, setBusy] = useState(false);

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      next.set(key, value);
      // Default to the chosen hospital/month so the URL is shareable + reloadable.
      if (!next.get("hospital")) next.set("hospital", hospital);
      if (!next.get("month")) next.set("month", month);
      router.replace(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router, hospital, month],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/billing/candidates?hospital=${encodeURIComponent(hospital)}&month=${encodeURIComponent(month)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setError(await readError(res));
        setData(null);
        return;
      }
      const body = (await res.json()) as CandidatesResponse;
      setData(body);
      setSelected(new Set());
    } catch {
      setError("Could not load the billing data. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [hospital, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const toStage = useMemo(
    () => (data?.candidates ?? []).filter((c) => !c.in_batch),
    [data],
  );

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
      await load();
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
      await load();
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
      await load();
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
      await load();
    } finally {
      setBusy(false);
    }
  }

  const batch = data?.batch ?? [];

  return (
    <div className="space-y-6">
      <section className="card grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="hospital">Hospital</label>
          <select
            id="hospital"
            className="input"
            value={hospital}
            onChange={(e) => setParam("hospital", e.target.value)}
          >
            {BILLING_HOSPITALS.map((h) => (
              <option key={h} value={h}>{h}</option>
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
      </section>

      {error ? <p className="text-state-danger text-sm">{error}</p> : null}
      {notice ? <p className="text-accent-teal text-sm">{notice}</p> : null}

      <section className="card space-y-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="section-title">Batch — {monthLabel(month)}</h2>
          <span className="text-text-secondary text-xs">{batch.length} file(s) staged</span>
        </div>

        {loading ? (
          <p className="text-text-secondary text-sm">Loading…</p>
        ) : batch.length === 0 ? (
          <p className="text-text-secondary text-sm">No files staged yet. Add candidates below.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
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
                    <td className="py-2 pr-3">{item.medical_aid_number ?? "—"}</td>
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

      <section className="card space-y-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="section-title">Candidates</h2>
          <button
            type="button"
            className="btn-secondary w-full sm:w-auto"
            disabled={busy || selected.size === 0}
            onClick={addSelected}
          >
            Add {selected.size > 0 ? `${selected.size} ` : ""}selected to batch
          </button>
        </div>

        {loading ? (
          <p className="text-text-secondary text-sm">Loading…</p>
        ) : toStage.length === 0 ? (
          <p className="text-text-secondary text-sm">
            No further candidates for this hospital — every active file is already in the batch.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {toStage.map((c) => (
              <li key={c.patient_id} className="flex items-center gap-3 py-2">
                <input
                  type="checkbox"
                  checked={selected.has(c.patient_id)}
                  onChange={() => toggle(c.patient_id)}
                  aria-label={`Select ${c.name}`}
                />
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="truncate text-xs text-text-secondary">
                    {c.file_number ?? "no file no."} · ID {c.id_number ?? "—"} · MA {c.medical_aid_number ?? "—"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
