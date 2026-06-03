import { buildInkSvgMarkup } from "./ink-render";

// Rasterise a saved ink payload to a PNG (base64, no data-URL prefix), entirely
// in the browser. The canvas renders SVG, not <canvas>, so there is no free
// canvas.toBlob(): we serialise the strokes to an SVG document, load it as an
// image, and draw that onto an offscreen canvas. The SVG is self-contained
// (inline <path> only, no external refs), so the canvas is not tainted and
// toBlob() succeeds.
//
// Called only at finalise time (client-side); touches DOM APIs lazily inside
// the function so the module stays import-safe.
export async function rasterizeInkToPngBase64(inkJson: string, scale = 2): Promise<string> {
  const built = buildInkSvgMarkup(inkJson);
  if (!built) throw new Error("nothing_to_rasterize");
  const { markup, width, height } = built;

  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("svg_load_failed"));
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("png_encode_failed");

  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}
