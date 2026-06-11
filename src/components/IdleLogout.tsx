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
const CHECK_EVERY_MS = 30_000;
const RESET_THROTTLE_MS = 30_000;

export function IdleLogout({ timeoutMinutes }: { timeoutMinutes: number }) {
  useEffect(() => {
    if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) return;
    const timeoutMs = timeoutMinutes * 60_000;

    let deadline = Date.now() + timeoutMs;
    let lastReset = Date.now();
    let firing = false;

    const reset = () => {
      const now = Date.now();
      if (now - lastReset < RESET_THROTTLE_MS) return;
      lastReset = now;
      deadline = now + timeoutMs;
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
      if (Date.now() >= deadline) void fire();
    };

    const onVisibility = () => {
      // Waking a tab that slept past its deadline locks immediately;
      // otherwise visibility counts as activity.
      if (document.visibilityState === "visible") {
        if (Date.now() >= deadline) void fire();
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
