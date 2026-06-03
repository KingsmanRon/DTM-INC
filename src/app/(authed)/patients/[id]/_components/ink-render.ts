import { getStroke } from "perfect-freehand";

export type InkPoint = [number, number, number];
export type InkPage = { strokes: InkPoint[][] };
export type InkDocument = { version: 1; pages: InkPage[] };

// Shared stroke styling so the live canvas and the read-back view render
// identically. Changing these here changes both.
export const STROKE_OPTIONS = {
  size: 4,
  thinning: 0.65,
  smoothing: 0.6,
  streamline: 0.5,
  simulatePressure: false,
} as const;

// Turn a perfect-freehand outline polygon into an SVG path string.
export function pathData(points: number[][]): string {
  if (points.length < 3) return "";
  const first = points[0]!;
  const segments = points.slice(1).map((point, index, rest) => {
    const next = rest[index + 1] ?? point;
    return `${point[0]} ${point[1]} ${(point[0]! + next[0]!) / 2} ${(point[1]! + next[1]!) / 2}`;
  });
  return `M ${first[0]} ${first[1]} Q ${segments.join(" ")} Z`;
}

// One raw stroke -> SVG path (outline via perfect-freehand).
export function strokePath(stroke: InkPoint[]): string {
  return pathData(getStroke(stroke, STROKE_OPTIONS));
}

// Content bounds of a page's strokes, used to derive a viewBox for read-back
// rendering: the live canvas captures absolute pixels with no viewBox, so the
// read view "fits" the ink to the available width. Defensive against malformed
// data so a single bad note never throws during render.
export function pageBounds(strokes: InkPoint[][], pad = 12): { width: number; height: number } {
  let maxX = 0;
  let maxY = 0;
  if (Array.isArray(strokes)) {
    for (const stroke of strokes) {
      if (!Array.isArray(stroke)) continue;
      for (const p of stroke) {
        const x = Number(p?.[0]);
        const y = Number(p?.[1]);
        if (Number.isFinite(x) && x > maxX) maxX = x;
        if (Number.isFinite(y) && y > maxY) maxY = y;
      }
    }
  }
  return { width: Math.max(maxX + pad, pad), height: Math.max(maxY + pad, pad) };
}
