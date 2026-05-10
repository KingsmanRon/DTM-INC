"use client";

import { useCallback, useEffect, useState } from "react";

// Chrome stashes the install prompt on a beforeinstallprompt event. We capture
// it, prevent Chrome's own banner, and expose a button that calls .prompt()
// from a user gesture. The button hides itself when the app is already
// installed (display-mode: standalone) or the prompt was never offered (e.g.
// site doesn't meet installability criteria, user already installed elsewhere,
// running on a browser without install support).
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function AndroidInstallButton() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) {
      setInstalled(true);
      return;
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const onClick = useCallback(async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    // The event can only be used once; drop the reference either way.
    setPromptEvent(null);
  }, [promptEvent]);

  if (installed || !promptEvent) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        zIndex: 1000,
        background: "#1F2A4A",
        color: "#E5E7EB",
        border: "1px solid #2A3964",
        borderRadius: 999,
        padding: "10px 16px",
        fontFamily: "Outfit, system-ui, sans-serif",
        fontSize: 14,
        cursor: "pointer",
        boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
      }}
    >
      Install DTM Inc.
    </button>
  );
}
