"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { detectInstallHelpPlatform, isStandaloneMode, trackPwaInstallEvent } from "@/lib/pwa-install";

const DISMISS_KEY = "dtm-ios-install-dismissal";
const DAY_MS = 24 * 60 * 60 * 1000;

type DismissState = { count: number; dismissedAt: number };

function shouldShowBanner(): boolean {
  if (typeof window === "undefined") return false;
  if (isStandaloneMode()) return false;

  const platform = detectInstallHelpPlatform();
  if (platform !== "ios" && platform !== "ipados") return false;

  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as DismissState;
    if (typeof parsed?.count !== "number" || typeof parsed?.dismissedAt !== "number") return true;
    if (parsed.count >= 3) return false;
    const snoozeMs = parsed.count === 1 ? 7 * DAY_MS : 30 * DAY_MS;
    return Date.now() - parsed.dismissedAt >= snoozeMs;
  } catch {
    return true;
  }
}

export function IOSInstallBanner() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!shouldShowBanner()) return;
    setVisible(true);
    trackPwaInstallEvent("pwa_ios_banner_shown", { platform: detectInstallHelpPlatform(), source: "ios_banner" });
  }, []);

  if (!visible || pathname === "/demo") return null;

  const dismiss = () => {
    setVisible(false);

    try {
      const raw = window.localStorage.getItem(DISMISS_KEY);
      const current = raw ? (JSON.parse(raw) as DismissState) : { count: 0, dismissedAt: 0 };
      const count = typeof current.count === "number" ? Math.max(0, current.count) + 1 : 1;
      const next: DismissState = {
        count: Math.min(3, count),
        dismissedAt: Date.now(),
      };
      window.localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {
      // Best effort.
    }

    trackPwaInstallEvent("pwa_ios_banner_dismissed", {
      platform: detectInstallHelpPlatform(),
      source: "ios_banner",
      outcome: "dismissed",
    });
  };

  return (
    <aside
      role="region"
      aria-label="Install instructions"
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: 12,
        zIndex: 1000,
        background: "#0F1830",
        color: "#E5E7EB",
        border: "1px solid #1F2A4A",
        borderRadius: 12,
        padding: "12px 14px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        fontFamily: "Outfit, system-ui, sans-serif",
        fontSize: 14,
        lineHeight: 1.4,
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
      }}
    >
      <div style={{ flex: 1 }}>
        <strong style={{ display: "block", marginBottom: 4 }}>Add DTM to your Home Screen</strong>
        <span>
          Tap the Share button, then choose Add to Home Screen. This lets you open DTM like an app.
        </span>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss install banner"
        style={{
          background: "transparent",
          border: "none",
          color: "#9CA3AF",
          fontSize: 14,
          lineHeight: 1,
          cursor: "pointer",
          padding: 4,
        }}
      >
        Dismiss
      </button>
    </aside>
  );
}
