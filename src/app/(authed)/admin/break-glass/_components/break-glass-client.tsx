"use client";

import { useCallback, useEffect, useState } from "react";
import InkView from "../../../patients/[id]/_components/ink-view";

// Emergency access to clinical notes (§10.4), finally operable from the UI
// (review #19): request with justification -> 48h cool-off -> 24h access
// window. Every step is audited server-side; the doctor can see break-glass
// events in their audit view. Until the notification email ships, practice
// policy is to TELL the doctor out of band when a request is raised — see
// docs/internal/break-glass-runbook.md.

type BreakGlassRequest = {
  id: string;
  target_patient_id: string;
  justification: string;
  requested_at: string;
  cool_off_until: string;
  accessed_at: string | null;
  access_window_ends: string | null;
  revoked_at: string | null;
};

type Note = {
  id: string;
  note_date: string;
  body: string;
  ink: string | null;
  is_finalised: boolean;
  created_at: string;
};

const MIN_JUSTIFICATION = 40;

function requestState(r: BreakGlassRequest): { label: string; tone: "danger" | "warning" | "success" | "muted"; canAccess: boolean } {
  const now = Date.now();
  if (r.revoked_at) return { label: "Revoked", tone: "danger", canAccess: false };
  if (new Date(r.cool_off_until).getTime() > now) {
    return { label: `Cool-off until ${new Date(r.cool_off_until).toLocaleString()}`, tone: "warning", canAccess: false };
  }
  if (!r.accessed_at) return { label: "Ready — not yet accessed", tone: "success", canAccess: true };
  if (r.access_window_ends && new Date(r.access_window_ends).getTime() > now) {
    return { label: `Window open until ${new Date(r.access_window_ends).toLocaleString()}`, tone: "success", canAccess: true };
  }
  return { label: "Access window expired", tone: "muted", canAccess: false };
}

export function BreakGlassClient() {
  const [requests, setRequests] = useState<BreakGlassRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [patientId, setPatientId] = useState("");
  const [justification, setJustification] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [accessingId, setAccessingId] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<{ requestId: string; notes: Note[]; windowEnds: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/break-glass", { credentials: "same-origin" });
      if (!res.ok) {
        setError("Could not load break-glass requests.");
        return;
      }
      const j = (await res.json()) as { requests: BreakGlassRequest[] };
      setRequests(j.requests ?? []);
    } catch {
      setError("Could not load break-glass requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/break-glass/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ target_patient_id: patientId.trim(), justification: justification.trim() }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(j?.message ?? "Could not create the request.");
        return;
      }
      setPatientId("");
      setJustification("");
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  async function access(r: BreakGlassRequest) {
    setAccessingId(r.id);
    setError(null);
    setNotesFor(null);
    try {
      const res = await fetch(`/api/v1/admin/break-glass/${r.id}/access`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
        setError(j?.message ?? j?.error ?? "Access refused.");
        await load();
        return;
      }
      const j = (await res.json()) as { notes: Note[]; access_window_ends: string };
      setNotesFor({ requestId: r.id, notes: j.notes ?? [], windowEnds: j.access_window_ends });
      await load();
    } finally {
      setAccessingId(null);
    }
  }

  const justificationShort = justification.trim().length < MIN_JUSTIFICATION;

  return (
    <div className="space-y-6">
      <form onSubmit={submitRequest} className="card space-y-3">
        <h2 className="section-title">Request emergency access</h2>
        <p className="text-text-secondary text-xs">
          48-hour cool-off applies before notes can be read; access then stays open for 24 hours.
          Every request and every read is permanently audited and visible to the doctor. Notify the
          doctor out of band when raising a request (see the break-glass runbook).
        </p>
        <div>
          <label className="label" htmlFor="bg-patient">Patient ID (UUID)</label>
          <input id="bg-patient" className="input font-mono" value={patientId}
                 onChange={(e) => setPatientId(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="bg-justification">
            Justification ({justification.trim().length}/{MIN_JUSTIFICATION} min characters)
          </label>
          <textarea id="bg-justification" className="input" rows={3} value={justification}
                    onChange={(e) => setJustification(e.target.value)} required />
        </div>
        <button type="submit" className="btn-primary" disabled={submitting || justificationShort || !patientId.trim()}>
          {submitting ? "Submitting…" : "Submit request (starts 48h cool-off)"}
        </button>
      </form>

      {error ? <p className="text-state-danger text-sm">{error}</p> : null}

      <div className="space-y-3">
        <h2 className="section-title">My requests</h2>
        {loading ? <p className="text-text-secondary text-sm">Loading…</p> : null}
        {!loading && requests.length === 0 ? (
          <p className="text-text-secondary text-sm">No break-glass requests.</p>
        ) : null}
        {requests.map((r) => {
          const state = requestState(r);
          const toneClass =
            state.tone === "danger" ? "bg-state-danger/20 text-state-danger"
            : state.tone === "warning" ? "bg-state-warning/20 text-state-warning"
            : state.tone === "success" ? "bg-state-success/20 text-state-success"
            : "bg-text-secondary/20 text-text-secondary";
          return (
            <div key={r.id} className="card space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <span className="font-mono text-xs">{r.target_patient_id}</span>
                  <span className={`ml-2 px-2 py-0.5 rounded text-xs ${toneClass}`}>{state.label}</span>
                </div>
                {state.canAccess ? (
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    disabled={accessingId === r.id}
                    onClick={() => access(r)}
                  >
                    {accessingId === r.id ? "Opening…" : "Access notes (audited)"}
                  </button>
                ) : null}
              </div>
              <p className="text-xs text-text-secondary">
                Requested {new Date(r.requested_at).toLocaleString()} · Justification: {r.justification}
              </p>

              {notesFor?.requestId === r.id ? (
                <div className="space-y-3 border-t border-border-subtle pt-3">
                  <p className="text-xs text-state-warning">
                    Emergency read — window closes {new Date(notesFor.windowEnds).toLocaleString()}.
                    This access has been recorded in the audit log.
                  </p>
                  {notesFor.notes.length === 0 ? (
                    <p className="text-text-secondary text-sm">No clinical notes on record for this patient.</p>
                  ) : notesFor.notes.map((n) => (
                    <div key={n.id} className="rounded border border-border-subtle p-3 space-y-2">
                      <div className="text-xs font-mono">{n.note_date} {n.is_finalised ? "· Finalised" : "· Draft"}</div>
                      {n.body ? <pre className="whitespace-pre-wrap text-sm font-sans">{n.body}</pre> : null}
                      {n.ink ? <InkView ink={n.ink} /> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
