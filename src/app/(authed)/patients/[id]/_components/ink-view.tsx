"use client";

import { pageBounds, strokePath, toStrokes, type InkPoint } from "./ink-render";

// Read-only renderer for a saved handwritten note. Switches on the payload
// `version`: a known version renders strokes; an unknown (newer) version shows
// a visible fallback instead of throwing, so notes stay legible across years of
// format evolution. Defensive parsing means a malformed note degrades to a
// message rather than crashing the whole notes tab.
type Parsed =
  | { kind: "ok"; pages: InkPoint[][][] }
  | { kind: "unsupported" }
  | { kind: "empty" };

function parseInk(ink: string): Parsed {
  let doc: unknown;
  try {
    doc = JSON.parse(ink);
  } catch {
    return { kind: "empty" };
  }
  if (!doc || typeof doc !== "object") return { kind: "empty" };
  if ((doc as { version?: unknown }).version !== 1) return { kind: "unsupported" };
  const rawPages = (doc as { pages?: unknown }).pages;
  if (!Array.isArray(rawPages)) return { kind: "empty" };
  const pages = rawPages.map(toStrokes).filter((strokes) => strokes.length > 0);
  if (pages.length === 0) return { kind: "empty" };
  return { kind: "ok", pages };
}

export default function InkView({ ink }: { ink: string }) {
  const parsed = parseInk(ink);

  if (parsed.kind === "unsupported") {
    return (
      <p className="text-sm text-state-warning">
        This handwritten note uses a newer format and can&apos;t be displayed here. Contact support.
      </p>
    );
  }
  if (parsed.kind === "empty") {
    return <p className="text-sm text-text-secondary">Handwritten note attached (nothing to display).</p>;
  }

  return (
    <div className="max-h-[480px] space-y-2 overflow-auto">
      {parsed.pages.map((strokes, pageIndex) => {
        const { width, height } = pageBounds(strokes);
        return (
          <svg
            key={pageIndex}
            aria-label={`Handwritten note page ${pageIndex + 1} of ${parsed.pages.length}`}
            className="w-full rounded border border-border-subtle bg-white"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ aspectRatio: `${width} / ${height}` }}
          >
            {strokes.map((stroke, i) => (
              <path key={i} d={strokePath(stroke)} fill="#0f172a" />
            ))}
          </svg>
        );
      })}
    </div>
  );
}
