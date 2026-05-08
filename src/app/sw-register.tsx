"use client";

import { useEffect } from "react";

// Registers /sw.js after window load. Defers behind the load event so the
// initial render isn't blocked by SW install/activate work, and to avoid
// holding up the navigation that triggered this layout. The existing SW
// (public/sw.js) handles the FR-14 shell-cache strategy — this file only
// wires it up.
export function SwRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        // Swallow — registration failure must never crash the app.
        // eslint-disable-next-line no-console
        console.error("[sw] registration failed", err);
      });
    };

    if (document.readyState === "complete") {
      onLoad();
    } else {
      window.addEventListener("load", onLoad, { once: true });
      return () => window.removeEventListener("load", onLoad);
    }
  }, []);

  return null;
}
