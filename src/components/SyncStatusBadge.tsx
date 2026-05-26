"use client";

import { useEffect, useMemo, useState } from "react";

export type SyncStatus = "online" | "offline" | "syncing" | "synced" | "needs_review";

const LABELS: Record<SyncStatus, string> = {
  online: "Online",
  offline: "Offline - changes saved on this device",
  syncing: "Syncing...",
  synced: "All changes synced",
  needs_review: "Some changes need review",
};

const STYLES: Record<SyncStatus, string> = {
  online: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  offline: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  syncing: "border-sky-500/40 bg-sky-500/10 text-sky-200",
  synced: "border-teal-500/40 bg-teal-500/10 text-teal-200",
  needs_review: "border-rose-500/40 bg-rose-500/10 text-rose-200",
};

export function SyncStatusBadge({
  pendingCount = 0,
  conflictCount = 0,
  isSyncing = false,
}: {
  pendingCount?: number;
  conflictCount?: number;
  isSyncing?: boolean;
}) {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(window.navigator.onLine);
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const status = useMemo<SyncStatus>(() => {
    if (conflictCount > 0) return "needs_review";
    if (!isOnline) return "offline";
    if (isSyncing) return "syncing";
    if (pendingCount > 0) return "online";
    return "synced";
  }, [conflictCount, isOnline, isSyncing, pendingCount]);

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
