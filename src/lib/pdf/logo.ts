// Letterhead logo for server-generated PDFs (review #30, v2 white-labelling).
//
// Resolution order:
//   1. practice_settings.logo_path -> object in the private `practice-brand`
//      bucket (admin client; PDFs are generated server-side only). This is the
//      per-practice override: upload a PNG, set logo_path, done — no deploy.
//   2. public/brand/logo-pdf.png — generic bundled filename a new practice can
//      drop into the repo.
//   3. public/brand/Dr. T. Mtshali_LOGO - PDF.png — the original DTM asset,
//      kept so the live deployment renders identically with zero data changes.
//
// Previously both PDF libs did a module-load readFileSync of the DTM filename:
// renaming the file crashed the routes at import time, and another practice
// meant editing code. Loading is now lazy with an in-memory TTL memo.
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getPracticeSettings } from "@/lib/practice/settings";

const TTL_MS = 10 * 60_000;
const BUNDLED_CANDIDATES = [
  path.join(process.cwd(), "public", "brand", "logo-pdf.png"),
  path.join(process.cwd(), "public", "brand", "Dr. T. Mtshali_LOGO - PDF.png"),
];

let memo: { buffer: Buffer; expiresAt: number } | null = null;

function bundledLogo(): Buffer {
  for (const candidate of BUNDLED_CANDIDATES) {
    try {
      if (fs.existsSync(candidate)) return fs.readFileSync(candidate);
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error(
    "pdf_logo_missing: no logo in practice-brand storage and no bundled fallback under public/brand/"
  );
}

export async function getPdfLogoBuffer(): Promise<Buffer> {
  const now = Date.now();
  if (memo && memo.expiresAt > now) return memo.buffer;

  let buffer: Buffer | null = null;
  try {
    const settings = await getPracticeSettings();
    const logoPath = (settings?.logo_path as string | undefined) ?? null;
    if (logoPath) {
      const admin = getSupabaseAdmin();
      const { data, error } = await admin.storage.from("practice-brand").download(logoPath);
      if (!error && data) buffer = Buffer.from(await data.arrayBuffer());
    }
  } catch {
    /* storage unavailable — fall through to the bundled asset */
  }

  if (!buffer) buffer = bundledLogo();
  memo = { buffer, expiresAt: now + TTL_MS };
  return buffer;
}
