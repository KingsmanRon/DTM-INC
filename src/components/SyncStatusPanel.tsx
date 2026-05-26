"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SyncStatusBadge } from "@/components/SyncStatusBadge";

const STORAGE_KEY = "dtm.offline.failed-actions";

export function SyncStatusPanel() {
  const [conflictCount, setConflictCount] = useState(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setConflictCount(parsed.length);
    } catch {
      setConflictCount(0);
    }
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <SyncStatusBadge conflictCount={conflictCount} />
      <Link href="/admin/conflicts" className="text-xs text-accent-teal hover:underline">Review sync conflicts</Link>
    </div>
  );
}
