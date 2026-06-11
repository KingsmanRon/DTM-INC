// Single source for white-label branding strings (v2 repackaging, review #30).
//
// Client-safe and import-safe everywhere: only NEXT_PUBLIC_* env vars (inlined
// at build time) with the current DTM values as defaults, so the existing
// deployment renders identically with no env changes. A new practice sets
// these in its Vercel project and never touches code.
//
// In-app PRACTICE identity (header name, PDFs, Information Officer) stays in
// practice_settings — that is per-DB data. This module covers only the strings
// needed BEFORE a database/session exists: login screen, PWA manifest, page
// metadata, and the TOTP issuer shown in authenticator apps.

export const Branding = {
  /** Short product/practice name: login heading, PWA name, header fallback. */
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "DTM Inc.",
  /** Browser tab / metadata title. */
  appTitle: process.env.NEXT_PUBLIC_APP_TITLE ?? "DTM Inc. — Patient Records",
  /** Metadata description. */
  appDescription:
    process.env.NEXT_PUBLIC_APP_DESCRIPTION ??
    "Dr. Thomas Mtshali Inc. — Specialist Laparoscopic and General Surgeon. Internal staff system.",
  /** Issuer label in authenticator apps (Google Authenticator, 1Password…). */
  mfaIssuer: process.env.NEXT_PUBLIC_APP_NAME ?? "DTM Inc",
} as const;
