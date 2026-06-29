"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

// KEEP IN SYNC with AuditAction in src/lib/audit/log.ts. A stale entry here
// only means a missing dropdown option — the API accepts any action string.
const AUDIT_ACTIONS = [
  "login_success", "login_failure", "login_lockout", "logout",
  "patient_view", "patient_create", "patient_update", "patient_archive", "patient_unarchive",
  "patient_file_reassigned",
  "document_upload", "document_view", "document_download", "document_archive", "document_rename",
  "note_create", "note_read", "note_amend", "note_finalise", "clinical_note_voided",
  "user_create", "user_deactivate", "user_reset_mfa", "permission_change",
  "practice_settings_update", "onboarding_pdf_generate",
  "break_glass_request", "break_glass_access",
  "consent_capture", "access_denied",
  "billing_export_generate", "billing_export_item_update", "billing_export_mark_returned",
] as const;

const PAGE_SIZE = 100;

type AuditRow = {
  id: string;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  patient_id: string | null;
  metadata_json: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
  occurred_at: string | null;
  chain_position: number;
};

export function AuditLogViewer() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [action, setAction] = useState("");
  const [patientId, setPatientId] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (action) params.set("action", action);
      if (patientId.trim()) params.set("patient_id", patientId.trim());
      const res = await fetch(`/api/v1/admin/audit-logs?${params.toString()}`, { credentials: "same-origin" });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(j?.message ?? "Could not load the audit log.");
        setRows([]);
        setHasMore(false);
        return;
      }
      const j = (await res.json()) as { data: AuditRow[]; hasMore: boolean };
      setRows(j.data ?? []);
      setHasMore(Boolean(j.hasMore));
    } catch {
      setError("Could not load the audit log.");
    } finally {
      setLoading(false);
    }
  }, [action, patientId, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  // Changing a filter returns to the first page.
  useEffect(() => {
    setOffset(0);
  }, [action, patientId]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <div>
          <label className="label" htmlFor="audit-action">Action</label>
          <select id="audit-action" className="input" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="audit-patient">Patient ID (UUID)</label>
          <input
            id="audit-patient"
            className="input font-mono"
            placeholder="Filter by patient UUID…"
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
          />
        </div>
      </div>

      {error ? <p className="text-state-danger text-sm">{error}</p> : null}
      {loading ? <p className="text-text-secondary text-sm">Loading…</p> : null}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[48rem] text-sm">
          <thead>
            <tr className="text-left text-text-secondary">
              <th className="py-2 pr-3">#</th>
              <th className="py-2 pr-3">Time (UTC)</th>
              <th className="pr-3">Action</th>
              <th className="pr-3">Role</th>
              <th className="pr-3">Entity</th>
              <th className="pr-3">Patient</th>
              <th className="pr-3">IP</th>
              <th className="pr-3">Detail</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr className="border-t border-border-subtle">
                  <td className="py-2 pr-3 text-text-secondary">{r.chain_position}</td>
                  <td className="py-2 pr-3">{new Date(r.created_at).toISOString()}</td>
                  <td className="pr-3">{r.action}</td>
                  <td className="pr-3">{r.actor_role ?? "—"}</td>
                  <td className="pr-3">{r.entity_type}{r.entity_id ? `/${r.entity_id.slice(0, 8)}` : ""}</td>
                  <td className="pr-3">{r.patient_id?.slice(0, 8) ?? "—"}</td>
                  <td className="pr-3">{r.ip_address ?? "—"}</td>
                  <td className="pr-3">
                    <button
                      type="button"
                      className="text-accent-teal hover:underline"
                      onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                    >
                      {expandedId === r.id ? "hide" : "view"}
                    </button>
                  </td>
                </tr>
                {expandedId === r.id ? (
                  <tr className="border-t border-border-subtle/40 bg-bg-primary/40">
                    <td colSpan={8} className="py-2 pr-3">
                      <pre className="whitespace-pre-wrap break-all text-[11px] text-text-secondary">
                        {JSON.stringify(
                          {
                            actor_user_id: r.actor_user_id,
                            occurred_at: r.occurred_at,
                            metadata: r.metadata_json,
                          },
                          null,
                          2
                        )}
                      </pre>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
            {!loading && rows.length === 0 ? (
              <tr><td colSpan={8} className="py-3 text-text-secondary">No audit rows match.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          className="btn-secondary"
          disabled={offset === 0 || loading}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
        >
          Newer
        </button>
        <span className="text-xs text-text-secondary">
          {offset + 1}–{offset + rows.length}
        </span>
        <button
          type="button"
          className="btn-secondary"
          disabled={!hasMore || loading}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          Older
        </button>
      </div>
    </div>
  );
}
