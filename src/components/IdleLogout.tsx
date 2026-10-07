"use client";

import { useEffect } from "react";

// FR-1 idle timeout, finally implemented (review #25): the SESSION_IDLE_TIMEOUT_*
// env vars were validated and documented but nothing consumed them. Mounted by
// the authenticated layout with the signed-in user's role-specific minutes.
//
// On expiry the SERVER signs the session out (so the logout is audited with
// reason "idle") and the user lands on /login with an explanatory notice. A
// front-desk machine left unattended therefore locks itself.
//
// Activity = pointer, key, or the tab becoming visible again. Resets are
// throttled to one per 30s so high-frequency events (scroll/move) cost nothing.
//
// The last activity is shared through localStorage by every tab of the
// browser. Tabs share the auth cookies and logout is global, so a background
// tab must not sign out a user who is working in another tab; with the shared
// time, all tabs reach the deadline together and the machine still locks.
const CHECK_EVERY_MS = 30_000;
const RESET_THROTTLE_MS = 30_000;
export const ACTIVITY_KEY = "idle-logout:last-activity";

type ActivityStore = Pick<Storage, "getItem" | "setItem">;

function browserStore(): ActivityStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Storage can be blocked (private mode, site data off); fall back to this tab.
export function readSharedActivity(store: ActivityStore | null): number {
  try {
    const value = Number(store?.getItem(ACTIVITY_KEY));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function writeSharedActivity(store: ActivityStore | null, at: number): void {
  try {
    store?.setItem(ACTIVITY_KEY, String(at));
  } catch {
    /* this tab's own timer still applies */
  }
}

export function idleExpired(now: number, ownActivity: number, sharedActivity: number, timeoutMs: number): boolean {
  return now >= Math.max(ownActivity, sharedActivity) + timeoutMs;
}

export function IdleLogout({ timeoutMinutes }: { timeoutMinutes: number }) {
  useEffect(() => {
    if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) return;
    const timeoutMs = timeoutMinutes * 60_000;
    const store = browserStore();

    let lastReset = Date.now();
    let firing = false;
    writeSharedActivity(store, lastReset);

    const expired = () => idleExpired(Date.now(), lastReset, readSharedActivity(store), timeoutMs);

    const reset = () => {
      const now = Date.now();
      if (now - lastReset < RESET_THROTTLE_MS) return;
      lastReset = now;
      writeSharedActivity(store, now);
    };

    const fire = async () => {
      if (firing) return;
      firing = true;
      try {
        await fetch("/api/v1/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ reason: "idle" }),
        });
      } catch {
        /* cookies may already be gone — navigation below still locks the UI */
      }
      window.location.assign("/login?reason=idle");
    };

    const tick = () => {
      if (expired()) void fire();
    };

    const onVisibility = () => {
      // Waking a tab after the browser sat idle past the deadline locks
      // immediately; otherwise visibility counts as activity.
      if (document.visibilityState === "visible") {
        if (expired()) void fire();
        else reset();
      }
    };

    const interval = window.setInterval(tick, CHECK_EVERY_MS);
    window.addEventListener("pointerdown", reset, { passive: true });
    window.addEventListener("keydown", reset);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [timeoutMinutes]);

  return null;
}
