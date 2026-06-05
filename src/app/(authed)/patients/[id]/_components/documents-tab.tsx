"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { MAX_DOCUMENT_BYTES } from "@/lib/documents/constants";

const BUCKET = "patient-documents";

type Doc = { id: string; category: string; original_filename: string; file_size: number; uploaded_at: string };

// Map server error codes to messages a clinician can act on. Falls back to a
// generic line for anything unexpected (the old code surfaced raw codes).
function friendlyUploadError(code: unknown): string {
  switch (code) {
    case "file_too_large": return "File too large — max 25 MB.";
    case "unsupported_media_type": return "Unsupported file type. Use PDF, JPG, PNG, HEIC or WEBP.";
    case "invalid_file_content": return "That file's contents don't match a supported document type.";
    case "invalid_category": return "Please choose a valid category.";
    case "empty_file": return "That file is empty.";
    case "uploaded_object_not_found": return "The upload didn't complete — please try again.";
    default: return "Upload failed.";
  }
}

const CATEGORIES = [
  "id_copy", "medical_aid_card", "consent_form", "referral_letter",
  "pathology_result", "imaging_report", "correspondence", "other",
];

export function DocumentsTab({ patientId }: { patientId: string }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [category, setCategory] = useState("other");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch(`/api/v1/patients/${patientId}/documents`, { credentials: "same-origin" });
    if (res.ok) { const j = await res.json(); setDocs(j.documents ?? []); }
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [patientId]);

  async function onUpload(file: File) {
    setBusy(true); setError(null);
    try {
      // 0. Pre-flight size check — friendlier than a round-trip to fail.
      if (file.size > MAX_DOCUMENT_BYTES) { setError("File too large — max 25 MB."); return; }

      // 1. Ask the API for a single-use signed upload URL (tiny JSON request,
      //    no file bytes — so it never hits Vercel's serverless body cap).
      const initRes = await fetch(`/api/v1/patients/${patientId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ filename: file.name, category, mime: file.type, size: file.size }),
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
        .uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (upErr) { setError("Upload failed while sending the file."); return; }

      // 3. Finalise: server re-checks size, sniffs content, hashes and records.
      const finRes = await fetch(`/api/v1/patients/${patientId}/documents/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ storageKey: path, filename: file.name, category, mime: file.type }),
      });
      if (!finRes.ok) {
        const j = await finRes.json().catch(() => ({}));
        setError(friendlyUploadError(j.error));
        return;
      }

      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function openDoc(docId: string) {
    const res = await fetch(`/api/v1/patients/${patientId}/documents/${docId}`, { credentials: "same-origin" });
    if (!res.ok) return;
    const j = await res.json();
    window.open(j.url, "_blank", "noopener,noreferrer");
  }

  function startRename(d: Doc) { setEditingId(d.id); setDraftName(d.original_filename); setRenameError(null); }
  function cancelRename() { setEditingId(null); setDraftName(""); setRenameError(null); }

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
      <div className="card flex items-end gap-3">
        <div>
          <label className="label">Category</label>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <div>
          <label className="label">File (PDF, JPG, PNG, HEIC, WEBP — max 25 MB)</label>
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/heic,image/webp"
                 disabled={busy}
                 onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onUpload(f); }} />
        </div>
        {busy ? <span className="text-text-secondary text-sm">Uploading…</span> : null}
        {error ? <span className="text-state-danger text-sm">{error}</span> : null}
      </div>

      <div className="card">
        <h3 className="section-title mb-3">Documents on file</h3>
        {docs.length === 0 ? <p className="text-text-secondary text-sm">No documents yet.</p> : (
          <ul className="divide-y divide-border-subtle">
            {docs.map((d) => (
              <li key={d.id} className="py-2 flex items-center justify-between gap-3">
                {editingId === d.id ? (
                  <div className="flex-1">
                    <form className="flex items-center gap-2"
                          onSubmit={(e) => { e.preventDefault(); onRename(d.id); }}>
                      <input className="input flex-1" value={draftName} autoFocus disabled={renaming}
                             aria-label="New file name"
                             onChange={(e) => setDraftName(e.target.value)}
                             onKeyDown={(e) => { if (e.key === "Escape") cancelRename(); }} />
                      <button type="submit" className="btn-secondary" disabled={renaming}>Save</button>
                      <button type="button" className="btn-secondary" disabled={renaming} onClick={cancelRename}>Cancel</button>
                    </form>
                    {renameError ? <p className="text-state-danger text-xs mt-1">{renameError}</p> : null}
                  </div>
                ) : (
                  <>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{d.original_filename}</div>
                      <div className="text-xs text-text-secondary">
                        {d.category.replace(/_/g, " ")} · {(d.file_size / 1024).toFixed(0)} KB · {new Date(d.uploaded_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button className="btn-secondary" onClick={() => startRename(d)}>Rename</button>
                      <button className="btn-secondary" onClick={() => openDoc(d.id)}>View</button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
