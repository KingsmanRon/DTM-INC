import { cp, mkdir, access } from "node:fs/promises";
import { parseArgs } from "node:util";
import { resolve, join, relative, sep } from "node:path";

const { values } = parseArgs({ options: { assets: { type: "string" }, out: { type: "string" } } });
if (!values.assets || !values.out) throw new Error("Supply --assets and --out. Creates isolated deployment source, never edits this checkout.");
const root = process.cwd();
const out = resolve(values.out);
if (!relative(root, out).startsWith(`client-output${sep}`)) throw new Error("Stage output must be a new directory under client-output/");
try { await access(out); throw new Error("Stage output already exists"); }
catch (err) { if (err.code !== "ENOENT") throw err; }
const assets = resolve(values.assets);
const assetNames = ["logo.png", "logo-pdf.png", "favicon-192x192.png", "favicon-512x512.png", "apple-touch-icon.png"];
for (const file of assetNames) await access(join(assets,file));
await mkdir(out, { recursive: true });
// Explicit source allowlist: no Git, environment files, local tooling settings,
// configuration bundles, patient data, node_modules or existing build outputs.
for (const name of ["src", "scripts", "docs", "supabase", "config", ".github", "package.json", "package-lock.json", "next.config.mjs", "tsconfig.json", "tsconfig.scripts.json", "tailwind.config.ts", "postcss.config.mjs", "vitest.config.ts", ".eslintrc.json", ".env.example", ".gitignore", "vercel.json", "README.md", "SPEC.md"]) {
  await cp(join(root,name), join(out,name), { recursive: true, filter: src => !/[\\/]supabase[\\/]\.(temp|branches)([\\/]|$)/.test(src) && !/[\\/]docs[\\/]business([\\/]|$)/.test(src) });
}
await mkdir(join(out,"public","client-brand"), { recursive: true });
await cp(join(root,"public","sw.js"), join(out,"public","sw.js"));
for (const name of assetNames) await cp(join(assets,name), join(out,"public","client-brand",name));
await cp(join(assets,"apple-touch-icon.png"), join(out,"public","apple-touch-icon.png"));
console.log("Prepared isolated deployment source. Set the generated branding variables and new project secrets before building. No deployment performed.");
