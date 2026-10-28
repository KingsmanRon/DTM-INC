"use client";

import { useState } from "react";
import { Badge, Callout } from "@/app/demo/_interactive/kit/Badge";
import { Button } from "@/app/demo/_interactive/kit/Button";
import { Dialog } from "@/app/demo/_interactive/kit/Dialog";
import { Icon } from "@/app/demo/_interactive/kit/Icon";
import { CATEGORY_LABEL, SAMPLE_DOCUMENTS } from "@/app/demo/_interactive/fixtures/documents";
import { can } from "@/app/demo/_interactive/state/permissions";
import { documentCompleteness } from "@/app/demo/_interactive/state/selectors";
import type { Patient, PatientDocument, SampleDocumentTemplate } from "@/app/demo/_interactive/types";
import { formatDateTime } from "@/app/demo/_interactive/kit/format";
import { useDemo } from "../DemoProvider";
import { SampleDocument } from "../SampleDocument";

export function DocumentsPanel({ patient }: { patient: Patient }) {
  const { model, act, announce } = useDemo();
  const [preview, setPreview] = useState<SampleDocumentTemplate | null>(null);
  const [openHistory, setOpenHistory] = useState<string | null>(null);

  const canAttach = can(model.role, "documents.attach") && patient.recordStatus === "active";
  const canArchive = can(model.role, "documents.archive") && patient.recordStatus === "active";
  const documents = model.documents
    .filter((d) => d.patientId === patient.id)
    .sort((a, b) => b.attachedAt.localeCompare(a.attachedAt));
  const onFile = documents.filter((d) => d.status === "on_file");
  const checklist = documentCompleteness(patient, model.documents);

  const openPreview = (template: SampleDocumentTemplate) => {
    setPreview(template);
    act({ type: "progress/mark", key: "documentPreviewed" });
  };

  const attach = (template: SampleDocumentTemplate) => {
    act({ type: "document/attach", patientId: patient.id, templateId: template.id });
    announce(`${template.title} attached to ${patient.firstNames} ${patient.surname}'s file.`);
  };

  const archive = (doc: PatientDocument) => {
    act({ type: "document/archive", documentId: doc.id });
    announce(`${doc.title} archived. It remains in the document history.`);
  };

  return (
    <div className="stack-lg">
      <div className="panel-grid">
        <section className="card card--pad" aria-labelledby="docs-title">
          <div className="panel-head">
            <div>
              <h2 id="docs-title" className="card__title">Documents on file</h2>
              <p className="card__lead">
                {onFile.length} on file{documents.length > onFile.length ? ` · ${documents.length - onFile.length} archived` : ""}
              </p>
            </div>
          </div>

          {documents.length === 0 ? (
            <div className="empty" style={{ marginTop: "1rem" }}>
              <strong>No documents on this file yet</strong>
              <span>Attach a bundled sample document to see the list update.</span>
            </div>
          ) : (
            <ul className="doc-list" aria-label="Patient documents">
              {documents.map((doc) => (
                <li key={doc.id} className="doc" data-status={doc.status}>
                  <span className="doc__icon" aria-hidden="true"><Icon name="file" /></span>
                  <div className="doc__main">
                    <p className="doc__title">{doc.title}</p>
                    <p className="doc__meta">
                      {CATEGORY_LABEL[doc.category]} · {doc.fileName} · {doc.sizeLabel}
                    </p>
                    <p className="doc__meta">
                      Attached {formatDateTime(doc.attachedAt)} by {doc.attachedBy}
                    </p>
                  </div>
                  <div className="doc__side">
                    {doc.status === "on_file" ? <Badge tone="success" icon="check">On file</Badge> : <Badge icon="archive">Archived</Badge>}
                    <div className="doc__actions">
                      <Button
                        size="sm"
                        icon="eye"
                        onClick={() => {
                          const tpl = SAMPLE_DOCUMENTS.find((t) => t.id === doc.templateId);
                          if (tpl) openPreview(tpl);
                        }}
                        aria-label={`Preview ${doc.title}`}
                      >
                        Preview
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="history"
                        aria-expanded={openHistory === doc.id}
                        aria-controls={`hist-${doc.id}`}
                        onClick={() => setOpenHistory(openHistory === doc.id ? null : doc.id)}
                        aria-label={`History of ${doc.title}`}
                      >
                        History
                      </Button>
                      {doc.status === "on_file" && canArchive ? (
                        <Button size="sm" variant="ghost" icon="archive" onClick={() => archive(doc)} aria-label={`Archive ${doc.title}`}>
                          Archive
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {openHistory === doc.id ? (
                    <ol className="doc__history" id={`hist-${doc.id}`} aria-label={`Document history for ${doc.title}`}>
                      {[...doc.history].reverse().map((h, i) => (
                        <li key={`${h.at}-${i}`}>
                          <span className="mono">{formatDateTime(h.at)}</span> · <strong>{h.action}</strong> by {h.actor}. {h.detail}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="stack">
          <section className="card card--pad" aria-labelledby="check-title">
            <h2 id="check-title" className="card__title">File checklist</h2>
            <p className="card__lead">What a complete file holds for this patient.</p>
            <ul className="checklist">
              {checklist.map((item) => (
                <li key={item.category} data-done={item.present}>
                  <Icon name={item.present ? "check" : "alert"} />
                  <span>{item.label}</span>
                  <span className="checklist__state">{item.present ? "On file" : "Missing"}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <section className="card card--pad" aria-labelledby="attach-title">
        <h2 id="attach-title" className="card__title">Attach a sample document</h2>
        <p className="card__lead">
          Public uploads are disabled in this demonstration. Choose one of the bundled fictional documents to simulate
          attaching it to the patient file.
        </p>
        {!canAttach ? (
          <Callout tone="warn" icon="lock" className="mt">
            {patient.recordStatus === "archived"
              ? "This record is archived, so documents cannot be attached."
              : "This role cannot attach documents."}
          </Callout>
        ) : null}
        <ul className="sample-grid">
          {SAMPLE_DOCUMENTS.map((tpl) => {
            const already = documents.some((d) => d.templateId === tpl.id && d.status === "on_file");
            return (
              <li key={tpl.id} className="sample">
                <span className="sample__icon" aria-hidden="true"><Icon name="paperclip" /></span>
                <div className="sample__text">
                  <p className="sample__title">{tpl.title}</p>
                  <p className="sample__meta">{tpl.description}</p>
                </div>
                <div className="sample__actions">
                  <Button size="sm" icon="eye" onClick={() => openPreview(tpl)} aria-label={`Preview sample: ${tpl.title}`}>
                    Preview
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={already ? "check" : "paperclip"}
                    disabled={!canAttach || already}
                    onClick={() => attach(tpl)}
                    aria-label={already ? `${tpl.title} already on file` : `Attach ${tpl.title}`}
                  >
                    {already ? "On file" : "Attach"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <Dialog open={preview !== null} onClose={() => setPreview(null)} title={preview?.title ?? "Document preview"} wide>
        {preview ? (
          <div className="stack">
            <Callout tone="teal" icon="info">
              Fictional sample document, drawn on screen for this demonstration. It is not a real file.
            </Callout>
            <SampleDocument template={preview} patient={patient} />
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
