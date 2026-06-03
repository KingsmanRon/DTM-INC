"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import InkView from "./ink-view";

const InkCanvas = dynamic(() => import("./ink-canvas"), { ssr: false });

type Note = {
  id: string;
  note_date: string;
  body: string;
  ink: string | null;
  is_finalised: boolean;
  amended_from_note_id: string | null;
  created_at: string;
  updated_at: string;
};

// Doctor-only tab. §FR-8: chronological list (newest first), date + body.
// Matches the paper sheet's simplicity — no SOAP templates, no ICD-10.
//
// Clinical notes are append-only by policy: "Unfinalised" means "not yet
// locked" (only the Finalise transition is permitted on the row itself).
// To change wording, the doctor uses Amend, which creates a new note that
// supersedes the original via amended_from_note_id; the original is
// auto-finalised by the API. The chain is rendered with a "Supersedes"
// label on the new note and a "Superseded" badge on the original.
export function ClinicalNotesTab({ patientId, handwrittenNotesEnabled }: { patientId: string; handwrittenNotesEnabled: boolean }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [body, setBody] = useState("");
  const [ink, setInk] = useState<string | null>(null);
  const [showInkCanvas, setShowInkCanvas] = useState(false);
  const [noteDate, setNoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [amendingId, setAmendingId] = useState<string | null>(null);
  const [amendBody, setAmendBody] = useState("");
  const [amendDate, setAmendDate] = useState("");
  const [amendBusy, setAmendBusy] = useState(false);

  const byId = useMemo(() => {
    const m = new Map<string, Note>();
    for (const n of notes) m.set(n.id, n);
    return m;
  }, [notes]);
  const supersededIds = useMemo(() => {
    const s = new Set<string>();
    for (const n of notes) if (n.amended_from_note_id) s.add(n.amended_from_note_id);
    return s;
  }, [notes]);

  async function refresh() {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/v1/patients/${patientId}/clinical-notes`, { credentials: "same-origin" });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      setError(err?.error ?? "Could not load clinical notes.");
      setNotes([]);
      setLoading(false);
      return;
    }
    const j = await res.json();
    setNotes(j.notes ?? []);
    setLoading(false);
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [patientId]);

  async function onAdd() {
    if (!body.trim() && !ink) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/patients/${patientId}/clinical-notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ note_date: noteDate, body: body || undefined, ink: ink ?? undefined }),
    });
    setBusy(false);
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      setError(err?.error ?? "Could not save note.");
      return;
    }
    setBody("");
    setInk(null);
    setShowInkCanvas(false);
    await refresh();
  }

  async function onFinalise(noteId: string) {
    if (!confirm("Finalise this note? It will be locked. To change it later, use Amend — which creates a new note linked to this one.")) return;
    setError(null);
    const res = await fetch(`/api/v1/patients/${patientId}/clinical-notes/${noteId}/finalise`, {
      method: "POST", credentials: "same-origin",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      setError(err?.error ?? "Could not finalise note.");
      return;
    }
    await refresh();
  }

  function startAmend(n: Note) {
    setAmendingId(n.id);
    setAmendBody(n.body);
    setAmendDate(n.note_date);
    setError(null);
  }
  function cancelAmend() {
    setAmendingId(null);
    setAmendBody("");
    setAmendDate("");
  }
  async function submitAmend() {
    if (!amendingId || !amendBody.trim()) return;
    setAmendBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/patients/${patientId}/clinical-notes/${amendingId}/amend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ note_date: amendDate, body: amendBody }),
    });
    setAmendBusy(false);
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      setError(err?.message ?? err?.error ?? "Could not amend note.");
      return;
    }
    cancelAmend();
    await refresh();
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h3 className="section-title">New note</h3>
        <div className="flex gap-3 items-end">
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} />
          </div>
        </div>
        <textarea
          className="input font-mono"
          rows={6}
          placeholder="Clinical note — plain text or markdown"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        {handwrittenNotesEnabled ? (
          <div className="space-y-2">
            <button type="button" className="btn-secondary text-xs" onClick={() => setShowInkCanvas((shown) => !shown)}>
              {showInkCanvas ? "Hide handwriting canvas" : "Add handwriting"}
            </button>
            {showInkCanvas ? <InkCanvas onDone={(value) => { setInk(value); setShowInkCanvas(false); }} /> : null}
            {ink ? <p className="text-sm text-state-success">Handwritten draft attached.</p> : null}
          </div>
        ) : null}
        <button className="btn-primary" disabled={busy || (!body.trim() && !ink)} onClick={onAdd}>
          {busy ? "Saving…" : "Save note"}
        </button>
        {error ? <p className="text-state-danger text-sm">{error}</p> : null}
      </div>

      <div className="space-y-3">
        {loading ? (
          <p className="text-text-secondary text-sm">Loading notes…</p>
        ) : notes.length === 0 ? (
          <p className="text-text-secondary text-sm">No notes yet.</p>
        ) : notes.map((n) => {
          const isSuperseded = supersededIds.has(n.id);
          const supersedes = n.amended_from_note_id ? byId.get(n.amended_from_note_id) : null;
          const editing = amendingId === n.id;
          return (
            <div key={n.id} className={`card${isSuperseded ? " opacity-70" : ""}`}>
              <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                <div className="text-sm">
                  <span className="font-mono">{n.note_date}</span>
                  {n.is_finalised ? (
                    <span className="ml-2 px-2 py-0.5 rounded bg-state-success/20 text-state-success text-xs">Finalised</span>
                  ) : (
                    <span className="ml-2 px-2 py-0.5 rounded bg-state-warning/20 text-state-warning text-xs">Unfinalised</span>
                  )}
                  {isSuperseded ? (
                    <span className="ml-2 px-2 py-0.5 rounded bg-text-secondary/20 text-text-secondary text-xs">Superseded</span>
                  ) : null}
                  {supersedes ? (
                    <span className="ml-2 text-xs text-text-secondary">
                      Supersedes <span className="font-mono">{supersedes.note_date}</span>
                    </span>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  {!n.ink && !n.is_finalised && !editing && (
                    <button className="btn-secondary text-xs" onClick={() => onFinalise(n.id)}>Finalise</button>
                  )}
                  {!n.ink && !isSuperseded && !editing && (
                    <button className="btn-secondary text-xs" onClick={() => startAmend(n)}>Amend</button>
                  )}
                </div>
              </div>

              {editing ? (
                <div className="space-y-2">
                  <div>
                    <label className="label">Date</label>
                    <input
                      type="date"
                      className="input"
                      value={amendDate}
                      onChange={(e) => setAmendDate(e.target.value)}
                    />
                  </div>
                  <textarea
                    className="input font-mono"
                    rows={6}
                    value={amendBody}
                    onChange={(e) => setAmendBody(e.target.value)}
                  />
                  <p className="text-xs text-text-secondary">
                    Saving creates a new note that supersedes this one. The original is preserved
                    and locked.
                  </p>
                  <div className="flex gap-2">
                    <button
                      className="btn-primary text-xs"
                      disabled={amendBusy || !amendBody.trim()}
                      onClick={submitAmend}
                    >
                      {amendBusy ? "Saving…" : "Save amendment"}
                    </button>
                    <button className="btn-secondary text-xs" onClick={cancelAmend}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {n.body ? <pre className="whitespace-pre-wrap text-sm font-sans">{n.body}</pre> : null}
                  {n.ink ? (
                    <div className="space-y-1">
                      <p className="text-xs text-text-secondary">Handwritten note</p>
                      <InkView ink={n.ink} />
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
