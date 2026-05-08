"use client";

import { useEffect, useState } from "react";

// Brand-namespaced key so we don't collide with other apps on the same domain
// during local dev or if this is ever served alongside another product.
const DISMISS_KEY = "dtm-ios-install-dismissed";

type NavigatorWithStandalone = Navigator & { standalone?: boolean };

function isIosSafari(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;

  // iPhone / iPod / older iPad UAs.
  const isIPhoneFamily = /iPad|iPhone|iPod/.test(ua);

  // iPadOS 13+ reports a desktop-Safari UA. Detect via touch + Mac UA.
  // Patient demographic may use iPad in clinic, so include it.
  const isIPadOs13Plus =
    ua.includes("Mac") && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1;

  if (!isIPhoneFamily && !isIPadOs13Plus) return false;

  // In-app browsers and non-Safari iOS browsers cannot Add to Home Screen.
  // Filter Chrome iOS, Firefox iOS, Edge iOS, Opera iOS, and the Facebook /
  // Instagram in-app webviews.
  if (/CriOS|FxiOS|EdgiOS|OPiOS|FBAN|FBAV|Instagram/.test(ua)) return false;

  // Must literally be Safari (in-app WKWebViews omit "Safari").
  if (!/Safari/.test(ua)) return false;

  return true;
}

export function IOSInstallBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isIosSafari()) return;

    // Already installed — Safari sets navigator.standalone=true for home-screen launches.
    const nav = window.navigator as NavigatorWithStandalone;
    if (nav.standalone === true) return;

    // Dismissal is persisted across sessions. Guarded because some
    // privacy modes throw on localStorage access.
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      // If storage is unavailable we still show the banner; dismissing
      // it just won't persist, which is acceptable.
    }

    setVisible(true);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Best effort.
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Install DTM Inc. on your home screen"
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
        <strong style={{ display: "block", marginBottom: 4 }}>Install DTM Inc.</strong>
        <span>
          Tap{" "}
          <ShareIcon />{" "}
          then <em>Add to Home Screen</em> to install this app on your iPhone.
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
          fontSize: 20,
          lineHeight: 1,
          cursor: "pointer",
          padding: 4,
        }}
      >
        ×
      </button>
    </div>
  );
}

function ShareIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ verticalAlign: "-3px", display: "inline-block" }}
    >
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}
