"use client";

import { useRef, useState } from "react";

export function PrintCurrentFileButton({ pdfHref }: { pdfHref: string }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [printSrc, setPrintSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function printPdf() {
    setBusy(true);
    const separator = pdfHref.includes("?") ? "&" : "?";
    setPrintSrc(`${pdfHref}${separator}print_ts=${Date.now()}`);
  }

  function onPdfLoaded() {
    const frame = iframeRef.current;
    if (!frame?.contentWindow) {
      setBusy(false);
      return;
    }

    frame.contentWindow.focus();
    frame.contentWindow.print();
    setBusy(false);
  }

  return (
    <>
      <button type="button" className="btn-secondary" disabled={busy} onClick={printPdf}>
        {busy ? "Preparing print…" : "Print current file"}
      </button>
      {printSrc ? (
        <iframe
          ref={iframeRef}
          src={printSrc}
          title="Printable patient onboarding PDF"
          className="fixed h-0 w-0 border-0 opacity-0"
          onLoad={onPdfLoaded}
        />
      ) : null}
    </>
  );
}
