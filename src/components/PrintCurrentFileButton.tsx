"use client";

export function PrintCurrentFileButton({ pdfHref }: { pdfHref: string }) {
  function openPrintablePdf() {
    const separator = pdfHref.includes("?") ? "&" : "?";
    window.open(`${pdfHref}${separator}print_ts=${Date.now()}`, "_blank", "noopener,noreferrer");
  }

  return (
    <button type="button" className="btn-secondary" onClick={openPrintablePdf}>
      Print current file
    </button>
  );
}
