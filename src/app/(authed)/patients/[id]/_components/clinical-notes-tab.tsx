"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import InkView from "./ink-view";
import { rasterizeInkToPngBase64 } from "./ink-raster";

const InkCanvas = dynamic(() => import("./ink-canvas"), { ssr: false });

type Note = {
  id: string;
  note_date: string;
  body: string;
  ink: string | null;
  is_finalised: boolean;
  amended_from_note_id: string | null;
  voided_at: string | null;
  voided_by: string | null;
  voided_by_name: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
};

// Doctor-only tab. §FR-8: chronological list (newest first), date + body.
// Matches the paper sheet's simplicity — no SOAP templates, no ICD-10.
//
// Clinical notes are append-only by policy: "Unfinalised" means "not yet
// locked" (only the Finalise transition is permitted on the row itself).
// To change wording on a TYPED note, the doctor uses Amend, which creates a
// new note that supersedes the original via amended_from_note_id; the
// original is auto-finalised by the API. The chain renders with a
// "Supersedes" label on the new note and a "Superseded" badge on the
// original. Handwritten notes cannot be amended — amend is typed-only.
export function ClinicalNotesTab({ patientId, handwrittenNotesEnabled, handwrittenFinaliseEnabled, notesPdfEnabled }: { patientId: string; handwrittenNotesEnabled: boolean; handwrittenFinaliseEnabled: boolean; notesPdfEnabled: boolean }) {
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
  const [amendBusy, setAmendBusy] = useState(false);
  const [exportDate, setExportDate] = useState(new Date().toISOString().slice(0, 10));
  const [showVoidedNotes, setShowVoidedNotes] = useState(false);
  const [voidingNote, setVoidingNote] = useState<Note | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidBusy, setVoidBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const byId = useMemo(() => {
    const m = new Map<string, Note>();
    for (const n of notes.filter((note) => !note.voided_at)) m.set(n.id, n);
    return m;
  }, [notes]);
  const supersededIds = useMemo(() => {
    const s = new Set<string>();
    for (const n of notes.filter((note) => !note.voided_at)) if (n.amended_from_note_id) s.add(n.amended_from_note_id);
    return s;
  }, [notes]);

  async function refresh() {
    setLoading(true);
    setError(null);
    const qs = showVoidedNotes ? "?include_voided=true" : "";
    const res = await fetch(`/api/v1/patients/${patientId}/clinical-notes${qs}`, { credentials: "same-origin" });
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [patientId, showVoidedNotes]);

  async function onAdd() {
    if (!body.trim() && !ink) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
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

  async function onFinalise(n: Note) {
    if (!confirm("Finalise this note? It will be locked and can no longer be edited.")) return;
    setError(null);
    let init: RequestInit = { method: "POST", credentials: "same-origin" };
    if (n.ink) {
      // Handwritten notes capture a durable PNG at finalisation — the row becomes
      // immutable, so it can't be attached later. Rasterise the strokes
      // client-side and send them with the finalise request.
      let inkPng: string;
      try {
        inkPng = await rasterizeInkToPngBase64(n.ink);
      } catch {
        setError("Could not prepare the handwriting image for finalising. Please try again.");
        return;
      }
      init = {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ink_png: inkPng }),
      };
    }
    const res = await fetch(`/api/v1/patients/${patientId}/clinical-notes/${n.id}/finalise`, init);
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      setError(err?.message ?? err?.error ?? "Could not finalise note.");
      return;
    }
    await refresh();
  }

  // Amend is typed-only — handwritten notes are not amendable, so the Amend
  // button is never shown for an ink note (see render below).
  function startAmend(n: Note) {
    setAmendingId(n.id);
    setAmendBody(n.body);
    setError(null);
  }
  function cancelAmend() {
    setAmendingId(null);
    setAmendBody("");
  }
  async function submitAmend() {
    if (!amendingId || !amendBody.trim()) return;
    setAmendBusy(true);
    setError(null);
    // No note_date is sent — the API dates the amendment today. The original
    // encounter date stays visible via the "Supersedes <date>" label.
    const res = await fetch(`/api/v1/patients/${patientId}/clinical-notes/${amendingId}/amend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ body: amendBody.trim() }),
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

  function openVoidModal(note: Note) {
    setVoidingNote(note);
    setVoidReason("");
    setError(null);
    setSuccess(null);
  }

  function closeVoidModal() {
    if (voidBusy) return;
    setVoidingNote(null);
    setVoidReason("");
  }

  async function submitVoid() {
    if (!voidingNote || voidReason.trim().length < 3) return;
    setVoidBusy(true);
    setError(null);
    setSuccess(null);
    const res = await fetch(`/api/v1/patients/${patientId}/clinical-notes/${voidingNote.id}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ reason: voidReason.trim() }),
    });
    setVoidBusy(false);
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      setError(err?.message ?? err?.error ?? "Could not void note.");
      return;
    }
    setSuccess("Clinical note voided. The original remains preserved for audit/history.");
    setVoidingNote(null);
    setVoidReason("");
    await refresh();
  }

  const activeNotes = notes.filter((note) => !note.voided_at);
  const voidedNotes = notes
    .filter((note) => note.voided_at)
    .sort((a, b) => new Date(b.voided_at ?? 0).getTime() - new Date(a.voided_at ?? 0).getTime());

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
        {success ? <p className="text-state-success text-sm">{success}</p> : null}
      </div>

      {notesPdfEnabled ? (
        <div className="flex items-end justify-end gap-2">
          <div>
            <label className="label">Export date</label>
            <input type="date" className="input" value={exportDate} onChange={(e) => setExportDate(e.target.value)} />
          </div>
          <a
            className="btn-secondary"
            href={`/api/v1/patients/${patientId}/clinical-notes/pdf?disposition=inline&date=${exportDate}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Export notes PDF
          </a>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <h3 className="section-title">Clinical Notes</h3>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={showVoidedNotes}
            onChange={(event) => setShowVoidedNotes(event.target.checked)}
          />
          Show voided notes
        </label>
      </div>

      <div className="space-y-3">
        {loading ? (
          <p className="text-text-secondary text-sm">Loading notes…</p>
        ) : activeNotes.length === 0 ? (
          <p className="text-text-secondary text-sm">No active notes yet.</p>
        ) : activeNotes.map((n) => {
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
                  {(!n.ink || handwrittenFinaliseEnabled) && !n.is_finalised && !editing && (
                    <button className="btn-secondary text-xs" onClick={() => onFinalise(n)}>Finalise</button>
                  )}
                  {/* Amend is typed-only: never offered for handwritten (ink) notes. */}
                  {!isSuperseded && !editing && !n.ink && !n.voided_at && (
                    <button className="btn-secondary text-xs" onClick={() => startAmend(n)}>Amend</button>
                  )}
                  {n.is_finalised && !n.voided_at && !editing ? (
                    <button className="btn-secondary text-xs text-state-danger" onClick={() => openVoidModal(n)}>Void Note</button>
                  ) : null}
                </div>
              </div>

              {editing ? (
                <div className="space-y-2">
                  <textarea
                    className="input font-mono"
                    rows={6}
                    placeholder="Amended note — plain text or markdown"
                    value={amendBody}
                    onChange={(e) => setAmendBody(e.target.value)}
                  />
                  <p className="text-xs text-text-secondary">
                    Saving creates a new note dated today that supersedes this one. The original is
                    preserved and locked.
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

      {showVoidedNotes ? (
        <div className="space-y-3">
          <h3 className="section-title">Voided Notes</h3>
          {!loading && voidedNotes.length === 0 ? (
            <p className="text-text-secondary text-sm">No voided notes.</p>
          ) : null}
          {voidedNotes.map((n) => (
            <div key={n.id} className="card border-state-danger/40 bg-state-danger/5">
              <div className="flex items-start justify-between mb-2 gap-2 flex-wrap">
                <div className="text-sm space-y-1">
                  <div>
                    <span className="font-mono">{n.note_date}</span>
                    <span className="ml-2 px-2 py-0.5 rounded bg-state-danger/20 text-state-danger text-xs">Voided</span>
                  </div>
                  <p className="text-xs text-text-secondary">
                    Voided {n.voided_at ? new Date(n.voided_at).toLocaleString() : "date unavailable"}
                    {n.voided_by_name ? ` by ${n.voided_by_name}` : n.voided_by ? ` by ${n.voided_by}` : ""}
                  </p>
                  <p className="text-xs text-text-secondary">Reason: {n.void_reason}</p>
                </div>
              </div>
              <div className="space-y-2">
                {n.body ? <pre className="whitespace-pre-wrap text-sm font-sans">{n.body}</pre> : null}
                {n.ink ? (
                  <div className="space-y-1">
                    <p className="text-xs text-text-secondary">Handwritten note</p>
                    <InkView ink={n.ink} />
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {voidingNote ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card max-w-lg w-full space-y-4">
            <div>
              <h3 className="section-title">Void clinical note?</h3>
              <p className="text-sm text-text-secondary mt-2">
                This will not delete the note. It will mark the note as voided and remove it from the active clinical timeline. The original note will be preserved for audit/history.
              </p>
            </div>
            <div className="space-y-2">
              <label className="label">Reason for voiding</label>
              <textarea
                className="input"
                rows={4}
                required
                value={voidReason}
                onChange={(event) => setVoidReason(event.target.value)}
                placeholder="Created during system testing; entered against wrong patient; duplicate note; entered in error; incorrect clinical encounter"
              />
              {voidReason.trim().length > 0 && voidReason.trim().length < 3 ? (
                <p className="text-xs text-state-danger">Reason must be at least 3 characters.</p>
              ) : null}
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" disabled={voidBusy} onClick={closeVoidModal}>Cancel</button>
              <button className="btn-primary" disabled={voidBusy || voidReason.trim().length < 3} onClick={submitVoid}>
                {voidBusy ? "Voiding…" : "Void Note"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
