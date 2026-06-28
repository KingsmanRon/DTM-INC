import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  buildCompressedPath,
  compressDocumentImage,
  sha256Hex,
} from "./patient-doc-compression";

// A WebP file begins with the RIFF container magic "RIFF" .... "WEBP".
function isWebp(buf: Buffer): boolean {
  return buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP";
}

// A noisy, large PNG that does not trivially shrink — gives realistic sizes.
async function makeNoisyPng(width: number, height: number): Promise<Buffer> {
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256);
  return sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
}

// A flat document-like PNG (compresses very well to WebP).
async function makeFlatPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
  }).png().toBuffer();
}

describe("compressDocumentImage", () => {
  it("emits WebP smaller than the original for a default category", async () => {
    const png = await makeFlatPng(3000, 2000);
    const out = await compressDocumentImage(png, "correspondence", png.length);
    expect(out.kind).toBe("compressed");
    if (out.kind !== "compressed") return;
    expect(isWebp(out.buffer)).toBe(true);
    expect(out.size).toBeLessThan(png.length);
    expect(out.tier).toMatch(/^default/);
  });

  it("never upscales and caps the longest side at 2200px (default)", async () => {
    const png = await makeFlatPng(4000, 1000);
    const out = await compressDocumentImage(png, "correspondence", png.length);
    if (out.kind !== "compressed") throw new Error("expected compressed");
    const meta = await sharp(out.buffer).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(2200);
  });

  it("uses a text-critical tier (no aggressive downscale) for id_copy", async () => {
    const png = await makeFlatPng(2400, 1600);
    const out = await compressDocumentImage(png, "id_copy", png.length);
    if (out.kind !== "compressed") throw new Error("expected compressed");
    expect(out.tier).toMatch(/^text-critical/);
    // Text-critical still caps at 2200px but must never go to the 1800px retry tier.
    const meta = await sharp(out.buffer).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(2200);
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeGreaterThan(1800);
  });

  it("reports skipped-larger when the encode beats nothing", async () => {
    // A tiny already-compact source: pretend the original is 10 bytes so any
    // WebP output is necessarily 'larger'.
    const png = await makeNoisyPng(64, 64);
    const out = await compressDocumentImage(png, "correspondence", 10);
    expect(out.kind).toBe("skipped-larger");
  });

  it("bakes EXIF orientation before stripping (portrait stays portrait)", async () => {
    // 1000x600 landscape pixels tagged orientation 6 (rotate 90° CW on display)
    // should read back as 600x1000 after .rotate() bakes the orientation in.
    const tagged = await sharp({
      create: { width: 1000, height: 600, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const out = await compressDocumentImage(tagged, "correspondence", tagged.length + 1_000_000);
    if (out.kind !== "compressed") throw new Error("expected compressed");
    const meta = await sharp(out.buffer).metadata();
    // Orientation baked in -> tall, and no residual EXIF orientation tag remains.
    expect((meta.height ?? 0)).toBeGreaterThan(meta.width ?? 0);
    expect(meta.orientation === undefined || meta.orientation === 1).toBe(true);
  });
});

describe("buildCompressedPath", () => {
  it("targets the new compressed/v1 path with a .webp extension", () => {
    const p = buildCompressedPath("pat-1", "doc-9", "Scan of ID (front).png");
    expect(p).toBe("pat-1/doc-9/compressed/v1/Scan_of_ID__front_.webp");
  });
});

describe("sha256Hex", () => {
  it("is stable for identical bytes", () => {
    const a = Buffer.from("hello");
    expect(sha256Hex(a)).toBe(sha256Hex(Buffer.from("hello")));
  });
});
