"use client";

import { useState } from "react";
import { detectInstallHelpPlatform, trackPwaInstallEvent } from "@/lib/pwa-install";

export function InstallHelpLink() {
  const [open, setOpen] = useState(false);

  const openHelp = () => {
    setOpen(true);
    trackPwaInstallEvent("pwa_install_help_opened", {
      platform: detectInstallHelpPlatform(),
      source: "help_menu",
    });
  };

  const platform = typeof window === "undefined" ? "unknown" : detectInstallHelpPlatform();

  return (
    <>
      <button type="button" onClick={openHelp} className="hover:text-accent-teal underline underline-offset-4">
        How to install DTM on this device
      </button>
      {open ? (
        <aside role="region" aria-label="Install instructions" className="fixed inset-x-3 bottom-3 z-[1001] rounded-lg border border-border-subtle bg-surface-elevated p-3 text-sm shadow-lg">
          <p className="font-semibold mb-1">Add DTM to your Home Screen</p>
          {platform === "ios" || platform === "ipados" ? (
            <p>Tap the Share button, then choose Add to Home Screen. This lets you open DTM like an app.</p>
          ) : (
            <p>Open your browser menu and choose Install app or Add to Home screen when available.</p>
          )}
          <div className="mt-2">
            <button type="button" aria-label="Dismiss install banner" onClick={() => setOpen(false)} className="text-text-secondary hover:text-text-primary">
              Dismiss
            </button>
          </div>
        </aside>
      ) : null}
    </>
  );
}
