"use client";

export function PrintCurrentFileButton() {
  return (
    <button type="button" className="btn-secondary" onClick={() => window.print()}>
      Print current file
    </button>
  );
}
