import { parseArgs } from "node:util";
import { mkdir, copyFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import sharp from "sharp";

const { values } = parseArgs({ options: {
  logo: { type: "string" }, letterhead: { type: "string" }, icon: { type: "string" }, out: { type: "string" },
} });
if (!values.logo || !values.letterhead || !values.icon || !values.out)
  throw new Error("Supply --logo, --letterhead, --icon and --out. Inputs must be owner supplied PNGs; icons must be square.");
const out = resolve(values.out);
try { await access(out); throw new Error("Output already exists; preserve the previous asset bundle and choose a new directory"); }
catch (err) { if (err.code !== "ENOENT") throw err; }
for (const key of ["logo", "letterhead", "icon"]) {
  const m = await sharp(values[key]).metadata();
  if (m.format !== "png" || !m.width || !m.height || (key === "icon" && m.width !== m.height))
    throw new Error(`${key} must be PNG; the icon must be square`);
}
await mkdir(out, { recursive: true });
await copyFile(values.logo, join(out, "logo.png"));
await copyFile(values.letterhead, join(out, "logo-pdf.png"));
for (const size of [192, 512]) await sharp(values.icon).resize(size, size).png().toFile(join(out, `favicon-${size}x${size}.png`));
await sharp(values.icon).resize(180, 180).png().toFile(join(out, "apple-touch-icon.png"));
console.log("Prepared branding assets. Review icon legibility and letterhead before deploying.");
