"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detectInstallHelpPlatform, isStandaloneMode, trackPwaInstallEvent } from "@/lib/pwa-install";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function AndroidInstallButton() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const shownTracked = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (isStandaloneMode()) {
      setInstalled(true);
      return;
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
      shownTracked.current = false;
      trackPwaInstallEvent("pwa_android_beforeinstallprompt_fired", { platform: "android", source: "android_button" });
    };

    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
      trackPwaInstallEvent("pwa_android_appinstalled", { platform: detectInstallHelpPlatform(), source: "android_button" });
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!installed && promptEvent && !shownTracked.current) {
      shownTracked.current = true;
      trackPwaInstallEvent("pwa_android_install_button_shown", { platform: "android", source: "android_button" });
    }
  }, [installed, promptEvent]);

  const onClick = useCallback(async () => {
    if (!promptEvent) return;

    trackPwaInstallEvent("pwa_android_install_button_clicked", { platform: "android", source: "android_button" });
    const currentPrompt = promptEvent;
    setPromptEvent(null);

    await currentPrompt.prompt();

    const choice = await currentPrompt.userChoice;
    if (choice?.outcome === "accepted") {
      trackPwaInstallEvent("pwa_android_install_prompt_accepted", {
        platform: "android",
        source: "android_button",
        outcome: "accepted",
      });
      return;
    }

    trackPwaInstallEvent("pwa_android_install_prompt_dismissed", {
      platform: "android",
      source: "android_button",
      outcome: "dismissed",
    });
  }, [promptEvent]);

  if (installed || !promptEvent || isStandaloneMode()) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Install DTM Inc."
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
      Install DTM
    </button>
  );
}
