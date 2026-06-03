"use client";

import { useMemo, useRef, useState, type PointerEvent } from "react";
import { strokePath } from "./ink-render";
import { MAX_INK_PAGES } from "@/lib/clinical-notes/limits";

type Point = [number, number, number];
type Page = { strokes: Point[][] };
type InkDocument = { version: 1; pages: Page[] };

function emptyDocument(): InkDocument { return { version: 1, pages: [{ strokes: [] }] }; }

export default function InkCanvas({ onDone }: { onDone: (ink: string) => void }) {
  const [document, setDocument] = useState<InkDocument>(emptyDocument);
  const [pageIndex, setPageIndex] = useState(0);
  const [redo, setRedo] = useState<Point[][]>([]);
  const [drawing, setDrawing] = useState(false);
  const lastPenAt = useRef(0);
  const page = document.pages[pageIndex]!;

  const paths = useMemo(() => page.strokes.map((stroke) => strokePath(stroke)), [page.strokes]);

  function updatePage(strokes: Point[][]) {
    setDocument((current) => ({ ...current, pages: current.pages.map((item, index) => index === pageIndex ? { strokes } : item) }));
  }
  function pointFrom(clientX: number, clientY: number, pressure: number, rect: DOMRect): Point {
    return [clientX - rect.left, clientY - rect.top, pressure || 0.5];
  }
  function point(event: PointerEvent<SVGSVGElement>): Point {
    return pointFrom(event.clientX, event.clientY, event.pressure, event.currentTarget.getBoundingClientRect());
  }
  function rejectPalm(event: PointerEvent<SVGSVGElement>) {
    if (event.pointerType === "pen") lastPenAt.current = Date.now();
    return event.pointerType === "touch" && Date.now() - lastPenAt.current < 800;
  }
  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (rejectPalm(event) || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    updatePage([...page.strokes, [point(event)]]);
    setRedo([]);
    setDrawing(true);
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!drawing || rejectPalm(event)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const native = event.nativeEvent;
    // Apple Pencil samples faster than pointermove fires; coalesced events
    // recover the dropped samples so fast strokes stay smooth, not polygonal.
    const coalesced = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    const samples = coalesced.length > 0
      ? coalesced.map((e) => pointFrom(e.clientX, e.clientY, e.pressure, rect))
      : [pointFrom(event.clientX, event.clientY, event.pressure, rect)];
    const next = [...page.strokes];
    next[next.length - 1] = [...next[next.length - 1]!, ...samples];
    updatePage(next);
  }
  function undo() {
    const removed = page.strokes.at(-1);
    if (!removed) return;
    updatePage(page.strokes.slice(0, -1));
    setRedo((current) => [...current, removed]);
  }
  function redoStroke() {
    const restored = redo.at(-1);
    if (!restored) return;
    updatePage([...page.strokes, restored]);
    setRedo((current) => current.slice(0, -1));
  }
  function addPage() {
    if (document.pages.length >= MAX_INK_PAGES) return;
    setDocument((current) => ({ ...current, pages: [...current.pages, { strokes: [] }] }));
    setPageIndex(document.pages.length);
    setRedo([]);
  }

  const hasInk = document.pages.some((item) => item.strokes.length > 0);
  const atPageLimit = document.pages.length >= MAX_INK_PAGES;
  return (
    <div className="space-y-2 rounded border border-border-subtle p-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm">Handwritten draft · page {pageIndex + 1}/{document.pages.length}</strong>
        <button type="button" className="btn-secondary text-xs" disabled={!page.strokes.length} onClick={undo}>Undo</button>
        <button type="button" className="btn-secondary text-xs" disabled={!redo.length} onClick={redoStroke}>Redo</button>
        <button type="button" className="btn-secondary text-xs" disabled={!page.strokes.length} onClick={() => { updatePage([]); setRedo([]); }}>Clear</button>
        <button type="button" className="btn-secondary text-xs" disabled={atPageLimit} onClick={addPage}>Add page</button>
        <button type="button" className="btn-primary text-xs" disabled={!hasInk} onClick={() => onDone(JSON.stringify(document))}>Done</button>
      </div>
      <svg
        aria-label="Handwritten clinical-note canvas"
        className="h-80 w-full touch-none rounded bg-white"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={() => setDrawing(false)}
        onPointerCancel={() => setDrawing(false)}
      >
        {paths.map((d, index) => <path key={index} d={d} fill="#0f172a" />)}
      </svg>
      <div className="flex gap-1">
        {document.pages.map((_, index) => <button type="button" key={index} className="btn-secondary text-xs" onClick={() => setPageIndex(index)}>Page {index + 1}</button>)}
      </div>
    </div>
  );
}
