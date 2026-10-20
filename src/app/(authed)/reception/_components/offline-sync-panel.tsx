"use client";

import { useEffect, useState } from "react";

export function OfflineSyncPanel() {
  const [isOnline, setIsOnline] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);

  useEffect(() => {
    const setFromNavigator = () => setIsOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    setFromNavigator();

    const onOnline = () => {
      setIsOnline(true);
      setLastSyncAt(new Date());
    };

    const onOffline = () => setIsOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return (
    <aside className="card flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="section-title text-base">Connectivity</p>
        <p className="text-xs text-text-secondary">
          {isOnline ? "Online. Reception actions will sync instantly." : "Offline mode. Actions are held until connectivity returns."}
        </p>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span
          className={`inline-flex h-2.5 w-2.5 rounded-full ${isOnline ? "bg-state-success" : "bg-state-warning"}`}
          aria-hidden
        />
        <span className={isOnline ? "text-state-success" : "text-state-warning"}>{isOnline ? "Online" : "Offline"}</span>
        <span className="text-text-secondary">
          {lastSyncAt ? `· Synced ${lastSyncAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "· Awaiting first sync"}
        </span>
      </div>
    </aside>
  );
}
