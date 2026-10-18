"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Suggested = { id: string; fileNumber: string; name: string; maskedId: string | null } | null;

type SearchResult = {
  id: string;
  file_number: string;
  first_names: string;
  surname: string;
  id_number: string | null;
};

type Choice = { id: string; label: string };

const REFERRER_TYPES = [
  { value: "gp", label: "GP" },
  { value: "specialist", label: "Specialist" },
  { value: "hospital", label: "Hospital" },
  { value: "other", label: "Other" },
];

async function post(url: string, body: unknown): Promise<{ ok: boolean; message?: string }> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return { ok: true };
  const json = (await res.json().catch(() => ({}))) as { message?: string; issues?: { message: string }[] };
  return { ok: false, message: json.issues?.[0]?.message ?? json.message ?? "Something went wrong. Please try again." };
}

export function ReferralActions({
  inboxId,
  reference,
  suggested,
}: {
  inboxId: string;
  reference: string;
  suggested: Suggested;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<Choice | null>(
    suggested ? { id: suggested.id, label: `${suggested.fileNumber} · ${suggested.name}` } : null
  );
  const [referrerType, setReferrerType] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Debounced lookup through the existing patient search (doctor + staff).
  useEffect(() => {
    const term = q.trim();
    abortRef.current?.abort();
    if (term.length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ q: term, page: "1", pageSize: "8" });
        const res = await fetch(`/api/v1/patients/search?${params.toString()}`, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        const json = (await res.json()) as { data?: SearchResult[] };
        setResults(json.data ?? []);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) setResults([]);
      } finally {
        if (abortRef.current === controller) setSearching(false);
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  async function accept() {
    if (!choice || !referrerType) return;
    setBusy("accept");
    setError(null);
    const result = await post(`/api/v1/access-referrals/${inboxId}/accept`, {
      patient_id: choice.id,
      referrer_type: referrerType,
    });
    setBusy(null);
    if (!result.ok) {
      setError(result.message ?? null);
      return;
    }
    router.push(`/patients/${choice.id}`);
    router.refresh();
  }

  async function decline() {
    setBusy("decline");
    setError(null);
    const result = await post(`/api/v1/access-referrals/${inboxId}/decline`, { reason });
    setBusy(null);
    if (!result.ok) {
      setError(result.message ?? null);
      return;
    }
    router.push("/referrals");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <section className="card space-y-4" aria-labelledby="link-title">
        <div>
          <h2 id="link-title" className="section-title">Link to a patient file</h2>
          <p className="text-sm text-text-secondary">
            Choose the patient&rsquo;s existing file. New patient?{" "}
            <Link href="/patients/new" prefetch={false} className="text-accent-teal hover:underline">
              Onboard them first
            </Link>
            , then come back to {reference} and link it to the new file.
          </p>
        </div>

        {suggested ? (
          <div className="rounded border border-border-subtle p-3 text-sm">
            <div className="text-text-secondary text-xs mb-1">Possible match by ID number</div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-mono">{suggested.fileNumber}</span> · {suggested.name}
                {suggested.maskedId ? <span className="text-text-secondary"> · ID {suggested.maskedId}</span> : null}
              </span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setChoice({ id: suggested.id, label: `${suggested.fileNumber} · ${suggested.name}` })}
              >
                Use this file
              </button>
            </div>
          </div>
        ) : null}

        <div>
          <label htmlFor="patient-search" className="label">Find another file</label>
          <input
            id="patient-search"
            className="input"
            placeholder="File number, name or ID number"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {searching ? <p className="text-xs text-text-secondary mt-1">Searching…</p> : null}
          {results.length > 0 ? (
            <ul className="mt-2 border border-border-subtle rounded divide-y divide-border-subtle text-sm">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-bg-primary"
                    onClick={() => {
                      setChoice({ id: r.id, label: `${r.file_number} · ${r.surname}, ${r.first_names}` });
                      setQ("");
                      setResults([]);
                    }}
                  >
                    <span className="font-mono">{r.file_number}</span> · {r.surname}, {r.first_names}
                    {r.id_number ? <span className="text-text-secondary"> · ID {r.id_number}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="label">File</div>
            <p className="break-words">{choice ? choice.label : <span className="text-text-secondary">None chosen</span>}</p>
          </div>
          <div>
            <label htmlFor="referrer-type" className="label">Who referred the patient</label>
            <select
              id="referrer-type"
              className="input"
              value={referrerType}
              onChange={(e) => setReferrerType(e.target.value)}
            >
              <option value="" disabled>Choose…</option>
              {REFERRER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="button"
          className="btn-primary"
          disabled={!choice || !referrerType || busy !== null}
          onClick={accept}
        >
          {busy === "accept" ? "Linking…" : "Link referral to this file"}
        </button>
      </section>

      <section className="card space-y-3" aria-labelledby="decline-title">
        <h2 id="decline-title" className="section-title">Decline</h2>
        <div>
          <label htmlFor="decline-reason" className="label">Reason (kept with the referral)</label>
          <textarea
            id="decline-reason"
            className="input min-h-20"
            value={reason}
            maxLength={500}
            onChange={(e) => {
              setReason(e.target.value);
              setConfirmDecline(false);
            }}
          />
        </div>
        {confirmDecline ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">Decline {reference}? This cannot be undone.</span>
            <button type="button" className="btn-danger" disabled={busy !== null} onClick={decline}>
              {busy === "decline" ? "Declining…" : "Confirm decline"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setConfirmDecline(false)}>
              Keep it
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn-secondary"
            disabled={reason.trim().length < 3 || busy !== null}
            onClick={() => setConfirmDecline(true)}
          >
            Decline referral
          </button>
        )}
      </section>

      {error ? (
        <p role="alert" className="text-sm text-state-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
