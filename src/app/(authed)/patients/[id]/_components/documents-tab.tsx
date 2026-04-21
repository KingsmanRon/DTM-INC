"use client";

import { useEffect, useState } from "react";

type Doc = { id: string; category: string; original_filename: string; file_size: number; uploaded_at: string };

const CATEGORIES = [
  "id_copy", "medical_aid_card", "consent_form", "referral_letter",
  "pathology_result", "imaging_report", "correspondence", "other",
];

export function DocumentsTab({ patientId }: { patientId: string }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [category, setCategory] = useState("other");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch(`/api/v1/patients/${patientId}/documents`, { credentials: "same-origin" });
    if (res.ok) { const j = await res.json(); setDocs(j.documents ?? []); }
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [patientId]);

  async function onUpload(file: File) {
    setBusy(true); setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("category", category);
    const res = await fetch(`/api/v1/patients/${patientId}/documents`, {
      method: "POST",
      body: fd,
      credentials: "same-origin",
    });
    setBusy(false);
    if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error ?? "Upload failed"); return; }
    await refresh();
  }

  async function openDoc(docId: string) {
    const res = await fetch(`/api/v1/patients/${patientId}/documents/${docId}`, { credentials: "same-origin" });
    if (!res.ok) return;
    const j = await res.json();
    window.open(j.url, "_blank", "noopener,noreferrer");
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
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }} />
        </div>
        {busy ? <span className="text-text-secondary text-sm">Uploading…</span> : null}
        {error ? <span className="text-state-danger text-sm">{error}</span> : null}
      </div>

      <div className="card">
        <h3 className="section-title mb-3">Documents on file</h3>
        {docs.length === 0 ? <p className="text-text-secondary text-sm">No documents yet.</p> : (
          <ul className="divide-y divide-border-subtle">
            {docs.map((d) => (
              <li key={d.id} className="py-2 flex items-center justify-between">
                <div>
                  <div className="font-medium">{d.original_filename}</div>
                  <div className="text-xs text-text-secondary">
                    {d.category.replace(/_/g, " ")} · {(d.file_size / 1024).toFixed(0)} KB · {new Date(d.uploaded_at).toLocaleString()}
                  </div>
                </div>
                <button className="btn-secondary" onClick={() => openDoc(d.id)}>View</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
