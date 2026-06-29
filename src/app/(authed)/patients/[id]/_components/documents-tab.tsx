"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { MAX_DOCUMENT_BYTES, SOFT_DOCUMENT_WARNING_BYTES } from "@/lib/documents/constants";
import { optimiseDocumentImage } from "@/lib/documents/optimise";

const BUCKET = "patient-documents";

type Doc = { id: string; category: string; original_filename: string; file_size: number; uploaded_at: string };

// Map server error codes to messages a clinician can act on. Falls back to a
// generic line for anything unexpected (the old code surfaced raw codes).
function friendlyUploadError(code: unknown): string {
  switch (code) {
    case "file_too_large": return "This document is too large. Please retake the photo closer to the page, crop unnecessary background, or upload a PDF.";
    case "unsupported_media_type": return "Unsupported file type. Use PDF, JPG, PNG, HEIC or WEBP.";
    case "invalid_file_content": return "That file's contents don't match a supported document type.";
    case "invalid_category": return "Please choose a valid category.";
    case "empty_file": return "That file is empty.";
    case "uploaded_object_not_found": return "The upload didn't complete — please try again.";
    default: return "Upload failed.";
  }
}

// Split a filename into an editable base and a display-only extension, so the
// rename UI can lock the extension. Match mirrors the server's forceExtension
// (1–8 alphanumerics after a dot).
function splitFileName(filename: string): { base: string; ext: string } {
  const m = /^(.*)\.([A-Za-z0-9]{1,8})$/.exec(filename);
  if (m && m[1]) return { base: m[1], ext: m[2] ?? "" };
  return { base: filename, ext: "" };
}

const CATEGORIES = [
  "id_copy", "medical_aid_card", "consent_form", "referral_letter",
  "pathology_result", "imaging_report", "correspondence", "other",
];

export function DocumentsTab({ patientId }: { patientId: string }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [category, setCategory] = useState("other");
  const [busy, setBusy] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch(`/api/v1/patients/${patientId}/documents`, { credentials: "same-origin" });
    if (res.ok) { const j = await res.json(); setDocs(j.documents ?? []); }
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [patientId]);

  async function onUpload(file: File) {
    if (busy) return;
    setBusy(true); setError(null); setWarning(null); setUploadStatus("Optimising document…");
    try {
      const originalFilename = file.name;
      const optimised = await optimiseDocumentImage(file);
      const uploadFile = optimised.file;

      // 0. Post-optimisation size checks — the server enforces the same hard limit.
      if (uploadFile.size > MAX_DOCUMENT_BYTES) {
        setError("This document is too large. Please retake the photo closer to the page, crop unnecessary background, or upload a PDF.");
        return;
      }
      if (uploadFile.size > SOFT_DOCUMENT_WARNING_BYTES) {
        setWarning("This document is larger than 5 MB after optimisation and may take longer to upload.");
      }

      setUploadStatus("Uploading document…");

      // 1. Ask the API for a single-use signed upload URL (tiny JSON request,
      //    no file bytes — so it never hits Vercel's serverless body cap).
      const initRes = await fetch(`/api/v1/patients/${patientId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ filename: uploadFile.name, category, mime: uploadFile.type, size: uploadFile.size }),
      });
      if (!initRes.ok) {
        const j = await initRes.json().catch(() => ({}));
        setError(friendlyUploadError(j.error));
        return;
      }
      const { path, token } = await initRes.json();

      // 2. Send the bytes straight to Supabase Storage. Browser -> Supabase,
      //    never through our function, so the 4.5 MB cap is out of the path.
      const supabase = getSupabaseBrowser();
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .uploadToSignedUrl(path, token, uploadFile, { contentType: uploadFile.type });
      if (upErr) { setError("Upload failed while sending the file."); return; }

      // 3. Finalise: server re-checks size, sniffs content, hashes and records.
      const finRes = await fetch(`/api/v1/patients/${patientId}/documents/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ storageKey: path, filename: originalFilename, category, mime: uploadFile.type }),
      });
      if (!finRes.ok) {
        const j = await finRes.json().catch(() => ({}));
        setError(friendlyUploadError(j.error));
        return;
      }

      await refresh();
    } finally {
      setBusy(false); setUploadStatus(null);
    }
  }

  async function openDoc(docId: string) {
    const res = await fetch(`/api/v1/patients/${patientId}/documents/${docId}`, { credentials: "same-origin" });
    if (!res.ok) return;
    const j = await res.json();
    window.open(j.url, "_blank", "noopener,noreferrer");
  }

  // Edit the base name only — the extension is shown locked beside the field
  // and re-applied server-side, so it can't be changed or duplicated.
  function startRename(d: Doc) { setEditingId(d.id); setDraftName(splitFileName(d.original_filename).base); setRenameError(null); setRemovingId(null); }
  function cancelRename() { setEditingId(null); setDraftName(""); setRenameError(null); }

  // Remove = SOFT archive (mis-upload correction). The server keeps the bytes
  // and the row for the audit trail; the document just leaves this list.
  function startRemove(d: Doc) { setRemovingId(d.id); setRemoveReason(""); setRemoveError(null); setEditingId(null); }
  function cancelRemove() { setRemovingId(null); setRemoveReason(""); setRemoveError(null); }

  async function onRemove(docId: string) {
    setRemoving(true); setRemoveError(null);
    try {
      const res = await fetch(`/api/v1/patients/${patientId}/documents/${docId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(removeReason.trim() ? { reason: removeReason.trim() } : {}),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setRemoveError(j.message ?? "Couldn't remove — please try again.");
        return;
      }
      setRemovingId(null); setRemoveReason("");
      await refresh();
    } finally {
      setRemoving(false);
    }
  }

  async function onRename(docId: string) {
    const name = draftName.trim();
    if (!name) { setRenameError("Name can't be empty."); return; }
    setRenaming(true); setRenameError(null);
    try {
      const res = await fetch(`/api/v1/patients/${patientId}/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ filename: name }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setRenameError(j.message ?? "Couldn't rename — please try again.");
        return;
      }
      setEditingId(null); setDraftName("");
      await refresh();
    } finally {
      setRenaming(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="w-full sm:w-auto">
          <label className="label">Category</label>
          <select className="input sm:w-56" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <div className="w-full sm:w-auto">
          <label className="label">File (PDF, JPG, PNG, HEIC, WEBP — max 10 MB after optimisation)</label>
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp"
                 disabled={busy}
                 className="block w-full max-w-full text-sm file:mr-3 file:rounded file:border file:border-border-subtle file:bg-surface-elevated file:px-3 file:py-1.5 file:text-text-primary"
                 onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onUpload(f); }} />
        </div>
        {busy ? <span className="text-text-secondary text-sm">{uploadStatus ?? "Uploading document…"}</span> : null}
        {warning ? <span className="text-amber-600 text-sm">{warning}</span> : null}
        {error ? <span className="text-state-danger text-sm">{error}</span> : null}
      </div>

      <div className="card">
        <h3 className="section-title mb-3">Documents on file</h3>
        {docs.length === 0 ? <p className="text-text-secondary text-sm">No documents yet.</p> : (
          <ul className="divide-y divide-border-subtle">
            {docs.map((d) => {
              const ext = splitFileName(d.original_filename).ext;
              return (
              <li key={d.id} className="py-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                {editingId === d.id ? (
                  <div className="flex-1">
                    <form className="flex flex-wrap items-center gap-2"
                          onSubmit={(e) => { e.preventDefault(); onRename(d.id); }}>
                      <input className="input min-w-0 flex-1" value={draftName} autoFocus disabled={renaming}
                             aria-label="New file name"
                             onChange={(e) => setDraftName(e.target.value)}
                             onKeyDown={(e) => { if (e.key === "Escape") cancelRename(); }} />
                      {ext ? <span className="text-text-secondary text-sm shrink-0">.{ext}</span> : null}
                      <button type="submit" className="btn-secondary" disabled={renaming}>Save</button>
                      <button type="button" className="btn-secondary" disabled={renaming} onClick={cancelRename}>Cancel</button>
                    </form>
                    {renameError ? <p className="text-state-danger text-xs mt-1">{renameError}</p> : null}
                  </div>
                ) : removingId === d.id ? (
                  <div className="flex-1 space-y-2">
                    <p className="text-sm">
                      Remove <span className="font-medium">{d.original_filename}</span> from this patient&apos;s file?
                    </p>
                    <p className="text-xs text-text-secondary">
                      The document leaves this list but is preserved for the audit record. Use this to
                      correct a wrong upload.
                    </p>
                    <input
                      className="input w-full"
                      placeholder="Reason (optional) — e.g. uploaded to the wrong patient"
                      value={removeReason}
                      disabled={removing}
                      onChange={(e) => setRemoveReason(e.target.value)}
                    />
                    <div className="flex items-center gap-2">
                      <button type="button" className="btn-primary" disabled={removing} onClick={() => onRemove(d.id)}>
                        {removing ? "Removing…" : "Remove document"}
                      </button>
                      <button type="button" className="btn-secondary" disabled={removing} onClick={cancelRemove}>Cancel</button>
                    </div>
                    {removeError ? <p className="text-state-danger text-xs">{removeError}</p> : null}
                  </div>
                ) : (
                  <>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{d.original_filename}</div>
                      <div className="text-xs text-text-secondary">
                        {d.category.replace(/_/g, " ")} · {(d.file_size / 1024).toFixed(0)} KB · {new Date(d.uploaded_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                      <button className="btn-secondary" onClick={() => startRename(d)}>Rename</button>
                      <button className="btn-secondary" onClick={() => openDoc(d.id)}>View</button>
                      <button className="btn-secondary text-state-danger" onClick={() => startRemove(d)}>Remove</button>
                    </div>
                  </>
                )}
              </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
