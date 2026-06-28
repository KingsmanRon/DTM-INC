"use client";

export type PwaPlatform = "android" | "ios" | "ipados" | "unknown";

export function isStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
}

type RelatedApplication = { platform?: string; url?: string; id?: string };

type NavigatorWithRelatedApps = Navigator & {
  getInstalledRelatedApps?: () => Promise<RelatedApplication[]>;
};

// Detects whether the PWA is already installed on this device — i.e. the user
// already has a DTM shortcut on their home screen / desktop. Unlike
// isStandaloneMode(), this is true even when the page is open in a normal
// browser tab rather than launched from the installed shortcut. It relies on
// navigator.getInstalledRelatedApps(), which reports the current PWA when the
// manifest lists itself under related_applications (see src/app/manifest.ts).
//
// Returns false on any platform/browser that doesn't support the API (iOS
// Safari, Firefox, etc.) so callers can fall back to their existing checks.
export async function hasInstalledAppShortcut(): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as NavigatorWithRelatedApps;
  if (typeof nav.getInstalledRelatedApps !== "function") return false;
  try {
    const apps = await nav.getInstalledRelatedApps();
    return Array.isArray(apps) && apps.some((app) => app?.platform === "webapp");
  } catch {
    return false;
  }
}

export function detectInstallHelpPlatform(): PwaPlatform {
  if (typeof window === "undefined") return "unknown";

  const ua = window.navigator.userAgent;
  const maxTouchPoints = window.navigator.maxTouchPoints ?? 0;
  const hasStandaloneProperty = "standalone" in window.navigator;
  const isSafariLike = /Safari/.test(ua) && !/Chrome|Chromium|Android/.test(ua);
  const excluded = /CriOS|FxiOS|EdgiOS|OPiOS|FBAN|FBAV|Instagram|LinkedInApp|Twitter|Line|DuckDuckGo/.test(ua);

  const iosOrIpadOsSafari = hasStandaloneProperty && maxTouchPoints > 1 && isSafariLike && !excluded;
  if (iosOrIpadOsSafari) return /iPad|Macintosh/.test(ua) ? "ipados" : "ios";
  if (/Android/i.test(ua)) return "android";
  return "unknown";
}

type PwaInstallEventMetadata = {
  platform?: PwaPlatform;
  standalone?: boolean;
  source?: "android_button" | "ios_banner" | "help_menu";
  outcome?: "accepted" | "dismissed" | "unavailable";
};

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function trackPwaInstallEvent(eventName: string, metadata?: PwaInstallEventMetadata) {
  if (typeof window === "undefined") return;
  const safeMetadata = {
    ...metadata,
    standalone: metadata?.standalone ?? isStandaloneMode(),
  };

  window.dispatchEvent(new CustomEvent("dtm:pwa-install-event", { detail: { eventName, ...safeMetadata } }));

  if (typeof window.gtag === "function") {
    window.gtag("event", eventName, safeMetadata);
  }
}
