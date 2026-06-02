"use client";

import { useMemo, useRef, useState, type PointerEvent } from "react";
import { getStroke } from "perfect-freehand";

type Point = [number, number, number];
type Page = { strokes: Point[][] };
type InkDocument = { version: 1; pages: Page[] };

function pathData(points: number[][]): string {
  if (points.length < 3) return "";
  const first = points[0]!;
  const segments = points.slice(1).map((point, index, rest) => {
    const next = rest[index + 1] ?? point;
    return `${point[0]} ${point[1]} ${(point[0]! + next[0]!) / 2} ${(point[1]! + next[1]!) / 2}`;
  });
  return `M ${first[0]} ${first[1]} Q ${segments.join(" ")} Z`;
}

function emptyDocument(): InkDocument { return { version: 1, pages: [{ strokes: [] }] }; }

export default function InkCanvas({ onDone }: { onDone: (ink: string) => void }) {
  const [document, setDocument] = useState<InkDocument>(emptyDocument);
  const [pageIndex, setPageIndex] = useState(0);
  const [redo, setRedo] = useState<Point[][]>([]);
  const [drawing, setDrawing] = useState(false);
  const lastPenAt = useRef(0);
  const page = document.pages[pageIndex]!;

  const outlines = useMemo(() => page.strokes.map((stroke) => getStroke(stroke, { size: 4, thinning: 0.65, smoothing: 0.6, streamline: 0.5, simulatePressure: false })), [page.strokes]);

  function updatePage(strokes: Point[][]) {
    setDocument((current) => ({ ...current, pages: current.pages.map((item, index) => index === pageIndex ? { strokes } : item) }));
  }
  function point(event: PointerEvent<SVGSVGElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top, event.pressure || 0.5];
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
    const next = [...page.strokes];
    next[next.length - 1] = [...next[next.length - 1]!, point(event)];
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
    setDocument((current) => ({ ...current, pages: [...current.pages, { strokes: [] }] }));
    setPageIndex(document.pages.length);
    setRedo([]);
  }

  const hasInk = document.pages.some((item) => item.strokes.length > 0);
  return (
    <div className="space-y-2 rounded border border-border-subtle p-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm">Handwritten draft · page {pageIndex + 1}/{document.pages.length}</strong>
        <button type="button" className="btn-secondary text-xs" disabled={!page.strokes.length} onClick={undo}>Undo</button>
        <button type="button" className="btn-secondary text-xs" disabled={!redo.length} onClick={redoStroke}>Redo</button>
        <button type="button" className="btn-secondary text-xs" disabled={!page.strokes.length} onClick={() => { updatePage([]); setRedo([]); }}>Clear</button>
        <button type="button" className="btn-secondary text-xs" onClick={addPage}>Add page</button>
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
        {outlines.map((outline, index) => <path key={index} d={pathData(outline)} fill="#0f172a" />)}
      </svg>
      <div className="flex gap-1">
        {document.pages.map((_, index) => <button type="button" key={index} className="btn-secondary text-xs" onClick={() => setPageIndex(index)}>Page {index + 1}</button>)}
      </div>
    </div>
  );
}
