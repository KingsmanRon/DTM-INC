"use client";

export type PwaPlatform = "android" | "ios" | "ipados" | "unknown";

export function isStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
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
