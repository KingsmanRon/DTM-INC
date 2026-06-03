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

// Pull the well-formed strokes out of one page, dropping anything malformed.
// Shared by the read view and the rasteriser so both tolerate bad data.
export function toStrokes(page: unknown): InkPoint[][] {
  if (!page || typeof page !== "object") return [];
  const strokes = (page as { strokes?: unknown }).strokes;
  if (!Array.isArray(strokes)) return [];
  return strokes.filter(
    (s): s is InkPoint[] => Array.isArray(s) && s.every((p) => Array.isArray(p) && p.length >= 2),
  );
}

// Build a standalone SVG document (all pages stacked vertically) for rasterising
// a saved note to PNG. Returns null when there's nothing to draw or the payload
// version is unknown. Geometry matches InkView (shared strokePath/pageBounds).
export function buildInkSvgMarkup(ink: string): { markup: string; width: number; height: number } | null {
  let doc: unknown;
  try {
    doc = JSON.parse(ink);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object" || (doc as { version?: unknown }).version !== 1) return null;
  const rawPages = (doc as { pages?: unknown }).pages;
  if (!Array.isArray(rawPages)) return null;

  const GAP = 16;
  let offsetY = 0;
  let maxW = 1;
  const groups: string[] = [];
  for (const page of rawPages) {
    const strokes = toStrokes(page);
    if (strokes.length === 0) continue;
    const { width, height } = pageBounds(strokes);
    const paths = strokes.map((s) => `<path d="${strokePath(s)}" fill="#0f172a"/>`).join("");
    groups.push(`<g transform="translate(0 ${offsetY})">${paths}</g>`);
    offsetY += height + GAP;
    if (width > maxW) maxW = width;
  }
  if (groups.length === 0) return null;
  const totalH = Math.max(offsetY - GAP, 1);
  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${maxW}" height="${totalH}" viewBox="0 0 ${maxW} ${totalH}">` +
    `<rect width="${maxW}" height="${totalH}" fill="#ffffff"/>${groups.join("")}</svg>`;
  return { markup, width: maxW, height: totalH };
}
