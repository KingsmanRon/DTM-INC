import {
  IMAGE_OPTIMISE_QUALITY,
  IMAGE_OPTIMISE_MAX_DIMENSION,
  OPTIMISED_IMAGE_MIME,
} from "@/lib/documents/constants";

const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/heic", "image/heif"]);

export type OptimiseResult = {
  file: File;
  wasOptimised: boolean;
  originalSize: number;
  error?: string;
};

export function isOptimisableImage(file: File): boolean {
  return IMAGE_MIME.has(file.type.toLowerCase());
}

function withJpgExtension(filename: string): string {
  const base = filename.replace(/\.[A-Za-z0-9]{1,8}$/, "") || "document";
  return `${base}.jpg`;
}

function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file, { imageOrientation: "from-image" });
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image_load_failed")); };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("image_encode_failed"));
    }, mime, quality);
  });
}

export async function optimiseDocumentImage(file: File): Promise<OptimiseResult> {
  if (!isOptimisableImage(file)) return { file, wasOptimised: false, originalSize: file.size };

  try {
    const image = await loadImage(file);
    const width = image.width;
    const height = image.height;
    if (!width || !height) return { file, wasOptimised: false, originalSize: file.size, error: "image_dimensions_unavailable" };

    const longest = Math.max(width, height);
    const scale = Math.min(1, IMAGE_OPTIMISE_MAX_DIMENSION / longest);
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("canvas_unavailable");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
    if ("close" in image && typeof image.close === "function") image.close();

    const blob = await canvasToBlob(canvas, OPTIMISED_IMAGE_MIME, IMAGE_OPTIMISE_QUALITY);
    // Keep the original if conversion/downscaling did not save at least 10%.
    if (blob.size >= file.size * 0.9) return { file, wasOptimised: false, originalSize: file.size };

    return {
      file: new File([blob], withJpgExtension(file.name), { type: OPTIMISED_IMAGE_MIME, lastModified: Date.now() }),
      wasOptimised: true,
      originalSize: file.size,
    };
  } catch (err) {
    return { file, wasOptimised: false, originalSize: file.size, error: err instanceof Error ? err.message : "optimise_failed" };
  }
}
