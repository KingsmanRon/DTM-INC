"use client";

import { useState } from "react";
import { Badge, Callout } from "@/app/demo/_interactive/kit/Badge";
import { Button } from "@/app/demo/_interactive/kit/Button";
import { Icon } from "@/app/demo/_interactive/kit/Icon";
import { TextAreaField, TextField } from "@/app/demo/_interactive/kit/Fields";
import { can } from "@/app/demo/_interactive/state/permissions";
import { MAX_NOTE_LENGTH } from "@/app/demo/_interactive/state/reducer";
import { latestVersion } from "@/app/demo/_interactive/state/selectors";
import type { ClinicalNote, Patient } from "@/app/demo/_interactive/types";
import { formatDateTime } from "@/app/demo/_interactive/kit/format";
import { AuditTimeline } from "../AuditTimeline";
import { useDemo } from "../DemoProvider";

const SAMPLE_NOTE =
  "Consultation (fictional). Patient seen for a routine review. Discussion held about the current plan. Follow-up to be arranged at the next visit.";

type Mode = "edit" | "amend" | "void" | null;

function statusBadge(note: ClinicalNote) {
  if (note.status === "voided") return <Badge tone="danger" icon="ban">Voided</Badge>;
  if (note.status === "draft") return <Badge tone="warn" icon="pen">Draft</Badge>;
  return note.versions.length > 1 ? (
    <Badge tone="info" icon="history">Finalised · amended</Badge>
  ) : (
    <Badge tone="success" icon="lock">Finalised</Badge>
  );
}

function NoteCard({ note }: { note: ClinicalNote }) {
  const { act, announce } = useDemo();
  const current = latestVersion(note);
  const [mode, setMode] = useState<Mode>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [body, setBody] = useState(current?.body ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<{ body?: string; reason?: string }>({});
  const id = note.id;

  const close = () => {
    setMode(null);
    setReason("");
    setError({});
  };

  const open = (next: Mode) => {
    setBody(current?.body ?? "");
    setReason("");
    setError({});
    setMode(next);
  };

  const saveDraft = () => {
    if (!body.trim()) return setError({ body: "A note cannot be empty." });
    act({ type: "note/save", noteId: id, body });
    announce("Draft saved.");
    close();
  };

  const submitAmend = () => {
    const next: typeof error = {};
    if (!body.trim()) next.body = "The amended note cannot be empty.";
    else if (body.trim() === current?.body) next.body = "Change the wording before saving an amendment.";
    if (!reason.trim()) next.reason = "Record why the note is being amended.";
    if (next.body || next.reason) return setError(next);
    act({ type: "note/amend", noteId: id, body, reason });
    announce("Amendment saved. The original version is preserved in the history.");
    close();
    setShowHistory(true);
  };

  const submitVoid = () => {
    if (!reason.trim()) return setError({ reason: "A reason is required to void a note." });
    act({ type: "note/void", noteId: id, reason });
    announce("Note voided. Its history remains visible.");
    close();
  };

  return (
    <li className="note card" data-status={note.status} aria-label={`Clinical note ${id.toUpperCase()}`}>
      <div className="note__head">
        <div className="note__title">
          <strong className="mono">{id.toUpperCase()}</strong>
          {statusBadge(note)}
          <span className="note__meta">
            Started {formatDateTime(note.createdAt)} · {note.versions[0]?.author}
          </span>
        </div>
      </div>

      <p className="note__body" data-void={note.status === "voided" || undefined}>
        {current?.body}
      </p>

      {note.status === "voided" && note.voided ? (
        <Callout tone="danger" icon="ban" title="Voided">
          {formatDateTime(note.voided.at)} by {note.voided.by}. Reason: {note.voided.reason}
        </Callout>
      ) : null}

      {mode === "edit" ? (
        <div className="note__form stack">
          <TextAreaField name={`note-${id}-edit`} label="Edit draft" value={body} maxLength={MAX_NOTE_LENGTH} onChange={(e) => setBody(e.target.value)} error={error.body} />
          <div className="row">
            <Button variant="primary" size="sm" onClick={saveDraft}>Save draft</Button>
            <Button variant="ghost" size="sm" onClick={close}>Cancel</Button>
          </div>
        </div>
      ) : null}

      {mode === "amend" ? (
        <div className="note__form stack">
          <p className="note__hint">
            The finalised original stays in the history. Your changes are saved as a new, linked version.
          </p>
          <TextAreaField name={`note-${id}-amend`} label="Amended note" value={body} maxLength={MAX_NOTE_LENGTH} onChange={(e) => setBody(e.target.value)} error={error.body} />
          <TextField name={`note-${id}-reason`} label="Reason for amendment" value={reason} onChange={(e) => setReason(e.target.value)} error={error.reason} />
          <div className="row">
            <Button variant="primary" size="sm" onClick={submitAmend}>Save amendment</Button>
            <Button variant="ghost" size="sm" onClick={close}>Cancel</Button>
          </div>
        </div>
      ) : null}

      {mode === "void" ? (
        <div className="note__form stack">
          <p className="note__hint">A voided note stays visible in the record with the reason. It is not deleted.</p>
          <TextField name={`note-${id}-void-reason`} label="Reason for voiding" value={reason} onChange={(e) => setReason(e.target.value)} error={error.reason} />
          <div className="row">
            <Button variant="danger" size="sm" onClick={submitVoid}>Void note</Button>
            <Button variant="ghost" size="sm" onClick={close}>Cancel</Button>
          </div>
        </div>
      ) : null}

      {mode === null ? (
        <div className="note__actions">
          {note.status === "draft" ? (
            <>
              <Button size="sm" icon="pen" onClick={() => open("edit")} aria-label={`Edit draft ${id.toUpperCase()}`}>Edit</Button>
              <Button size="sm" variant="primary" icon="lock" onClick={() => { act({ type: "note/finalise", noteId: id }); announce("Note finalised and locked."); }} aria-label={`Finalise ${id.toUpperCase()}`}>
                Finalise
              </Button>
            </>
          ) : null}
          {note.status === "finalised" ? (
            <Button size="sm" icon="pen" onClick={() => open("amend")} aria-label={`Amend ${id.toUpperCase()}`}>Amend</Button>
          ) : null}
          {note.status !== "voided" ? (
            <Button size="sm" variant="danger" icon="ban" onClick={() => open("void")} aria-label={`Void ${id.toUpperCase()}`}>Void</Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            icon="history"
            aria-expanded={showHistory}
            aria-controls={`history-${id}`}
            onClick={() => setShowHistory((v) => !v)}
            aria-label={`Version history of ${id.toUpperCase()}`}
          >
            History ({note.versions.length})
          </Button>
        </div>
      ) : null}

      {showHistory ? (
        <ol className="versions" id={`history-${id}`} aria-label={`Version history of note ${id.toUpperCase()}`}>
          {note.versions.map((v) => (
            <li key={v.version} className="version" data-kind={v.kind}>
              <p className="version__head">
                <strong>Version {v.version}</strong>
                <Badge tone={v.kind === "original" ? "neutral" : "info"}>{v.kind === "original" ? "Original" : "Amendment"}</Badge>
                <span className="note__meta">
                  {v.finalisedAt ? `Finalised ${formatDateTime(v.finalisedAt)}` : `Draft saved ${formatDateTime(v.savedAt)}`} · {v.author}
                </span>
              </p>
              <p className="version__body">{v.body}</p>
              {v.reason ? <p className="version__reason"><strong>Reason:</strong> {v.reason}</p> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

/** Doctor-only. The notes arrive via the role projection, which is empty for other roles. */
export function NotesPanel({ patient }: { patient: Patient }) {
  const { model, act, announce } = useDemo();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>();
  const canWrite = can(model.role, "notes.write") && patient.recordStatus === "active";

  const notes = model.notes
    .filter((n) => n.patientId === patient.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const events = model.clinicalActivity.filter((e) => e.subjectId === patient.id);

  const create = () => {
    if (!draft.trim()) return setError("Write the note before saving.");
    act({ type: "note/create", patientId: patient.id, body: draft });
    announce("Note saved as a draft.");
    setDraft("");
    setError(undefined);
  };

  return (
    <div className="stack-lg">
      <Callout tone="teal" icon="lock" title="Doctor only">
        These notes are visible to the Doctor role only. Reception and the Administrator never receive them.
      </Callout>

      <section className="card card--pad" aria-labelledby="composer-title">
        <h2 id="composer-title" className="card__title">New clinical note</h2>
        <p className="card__lead">Typed note for {patient.firstNames} {patient.surname}. Fictional text only.</p>
        <div className="stack mt">
          <TextAreaField
            name="newNote"
            label="Note"
            value={draft}
            maxLength={MAX_NOTE_LENGTH}
            disabled={!canWrite}
            onChange={(e) => { setDraft(e.target.value); setError(undefined); }}
            error={error}
            hint={`${draft.length} of ${MAX_NOTE_LENGTH} characters. Please do not enter real patient information.`}
          />
          <div className="row">
            <Button variant="primary" icon="check" onClick={create} disabled={!canWrite}>Save note</Button>
            <Button variant="ghost" icon="pen" onClick={() => { setDraft(SAMPLE_NOTE); setError(undefined); }} disabled={!canWrite}>
              Use sample note
            </Button>
          </div>
          <p className="note__hint">
            <Icon name="info" className="inline-icon" /> Handwritten (stylus) notes are available only where a
            practice’s configuration enables them. They are not enabled in this demonstration.
          </p>
        </div>
      </section>

      <section aria-labelledby="notes-title">
        <h2 id="notes-title" className="section-title">Notes for this patient</h2>
        {notes.length === 0 ? (
          <div className="empty">
            <strong>No clinical notes yet</strong>
            <span>Write and save the first note above.</span>
          </div>
        ) : (
          <ul className="stack">
            {notes.map((note) => (
              <NoteCard key={note.id} note={note} />
            ))}
          </ul>
        )}
      </section>

      <section className="card card--pad" aria-labelledby="note-audit-title">
        <h2 id="note-audit-title" className="card__title">Audit timeline for this patient’s notes</h2>
        <p className="card__lead">Actions only. The audit trail never contains note content.</p>
        <div className="mt">
          {events.length === 0 ? (
            <p className="card__lead">No clinical activity recorded yet.</p>
          ) : (
            <AuditTimeline events={events} label="Clinical note audit timeline" />
          )}
        </div>
      </section>
    </div>
  );
}
