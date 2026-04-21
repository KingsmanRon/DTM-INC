"use client";

import { useEffect, useState } from "react";

type Note = {
  id: string;
  note_date: string;
  body: string;
  is_finalised: boolean;
  amended_from_note_id: string | null;
  created_at: string;
  updated_at: string;
};

// Doctor-only tab. §FR-8: chronological list (newest first), date + body.
// Matches the paper sheet's simplicity — no SOAP templates, no ICD-10.
export function ClinicalNotesTab({ patientId }: { patientId: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [body, setBody] = useState("");
  const [noteDate, setNoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await fetch(`/api/v1/patients/${patientId}/clinical-notes`, { credentials: "same-origin" });
    if (res.ok) { const j = await res.json(); setNotes(j.notes ?? []); }
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [patientId]);

  async function onAdd() {
    if (!body.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/v1/patients/${patientId}/clinical-notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ note_date: noteDate, body }),
    });
    setBusy(false);
    if (res.ok) { setBody(""); await refresh(); }
  }

  async function onFinalise(noteId: string) {
    if (!confirm("Finalise this note? Future edits will create an amended copy.")) return;
    await fetch(`/api/v1/patients/${patientId}/clinical-notes/${noteId}/finalise`, {
      method: "POST", credentials: "same-origin",
    });
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
        <button className="btn-primary" disabled={busy || !body.trim()} onClick={onAdd}>
          {busy ? "Saving…" : "Save note"}
        </button>
      </div>

      <div className="space-y-3">
        {notes.length === 0 ? (
          <p className="text-text-secondary text-sm">No notes yet.</p>
        ) : notes.map((n) => (
          <div key={n.id} className="card">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm">
                <span className="font-mono">{n.note_date}</span>
                {n.is_finalised ? (
                  <span className="ml-2 px-2 py-0.5 rounded bg-state-success/20 text-state-success text-xs">Finalised</span>
                ) : (
                  <span className="ml-2 px-2 py-0.5 rounded bg-state-warning/20 text-state-warning text-xs">Draft</span>
                )}
                {n.amended_from_note_id ? <span className="ml-2 text-xs text-text-secondary">(amended)</span> : null}
              </div>
              {!n.is_finalised && (
                <button className="btn-secondary text-xs" onClick={() => onFinalise(n.id)}>Finalise</button>
              )}
            </div>
            <pre className="whitespace-pre-wrap text-sm font-sans">{n.body}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
