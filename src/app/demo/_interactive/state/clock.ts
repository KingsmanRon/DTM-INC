/**
 * Deterministic fictional clock. The demo never reads the real time: each
 * audited action advances a tick counter, and a tick maps to a fixed
 * fictional date so server and client always render identical output and
 * tests are repeatable.
 */

/** 28 Oct 2026, 09:00 in fictional South African local time. */
const BASE_MS = Date.UTC(2026, 9, 28, 9, 0);
const MINUTES_PER_TICK = 3;

export const DEMO_TODAY = "2026-10-28";
export const DEMO_MONTH = "2026-10";
/** Timestamps at or after this value were created during the live session. */
export const SESSION_START = "2026-10-28T09:00:00+02:00";

export function nowIso(tick: number): string {
  const date = new Date(BASE_MS + tick * MINUTES_PER_TICK * 60_000);
  return `${date.toISOString().slice(0, 16)}:00+02:00`;
}

export function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}
