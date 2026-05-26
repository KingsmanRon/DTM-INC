"use client";

import { useEffect, useMemo, useState } from "react";

type FailedAction = {
  id: string;
  entityType: "patient" | "note" | "document" | "unknown";
  entityId: string;
  action: "create" | "update" | "finalise" | "archive" | "unknown";
  reason: string;
  attemptedAt: string;
  protectedFields: string[];
  payloadSummary: string;
};

const STORAGE_KEY = "dtm.offline.failed-actions";

function readActions(): FailedAction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FailedAction[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeActions(actions: FailedAction[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(actions));
}

export function OfflineConflictReview() {
  const [actions, setActions] = useState<FailedAction[]>([]);

  useEffect(() => {
    setActions(readActions());
  }, []);

  const hasActions = useMemo(() => actions.length > 0, [actions]);

  function markResolved(id: string) {
    const next = actions.filter((a) => a.id !== id);
    setActions(next);
    writeActions(next);
  }

  return (
    <div className="card space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Conflict review</h1>
        <p className="text-sm text-text-secondary">
          Review conflicted offline actions before retrying. Protected fields are shown to prevent accidental overwrite.
        </p>
      </div>

      {!hasActions ? (
        <p className="text-sm text-text-secondary">No conflicted actions pending review.</p>
      ) : (
        <ul className="space-y-3">
          {actions.map((item) => (
            <li key={item.id} className="rounded-lg border border-border-subtle bg-bg-primary p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{item.action.toUpperCase()} {item.entityType} · {item.entityId}</p>
                <p className="text-xs text-text-secondary">Attempted: {new Date(item.attemptedAt).toLocaleString()}</p>
              </div>

              <p className="text-sm"><span className="font-medium">Reason:</span> {item.reason}</p>
              <p className="text-sm"><span className="font-medium">Payload summary:</span> {item.payloadSummary}</p>

              <div>
                <p className="text-xs font-medium text-text-secondary mb-1">Protected fields (read-only on retry)</p>
                <div className="flex flex-wrap gap-2">
                  {item.protectedFields.length > 0 ? item.protectedFields.map((field) => (
                    <span key={field} className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-xs text-rose-200">{field}</span>
                  )) : <span className="text-xs text-text-secondary">None declared</span>}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" onClick={() => markResolved(item.id)}>Mark resolved</button>
                <button className="btn-secondary" onClick={() => alert(`Retry queued for ${item.id}. Ensure protected fields remain unchanged.`)}>Retry safely</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
