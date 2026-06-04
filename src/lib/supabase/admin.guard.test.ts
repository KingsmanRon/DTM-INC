import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Guard: the service-role Supabase client (src/lib/supabase/admin.ts) bypasses
// RLS and uses SUPABASE_SERVICE_ROLE_KEY. It must NEVER reach a browser bundle
// or be used for normal app reads. `import "server-only"` enforces this at build
// time; this test fails fast in CI with a precise message if any Client
// Component (a `"use client"` module) imports it or the service-role key.

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function isClientModule(source: string): boolean {
  // The "use client" directive is only valid before any import/statement, so it
  // sits within the first few lines (after an optional comment banner).
  const head = source.split("\n").slice(0, 8).join("\n");
  return /^\s*["']use client["']/m.test(head);
}

const ADMIN_IMPORT = /from\s+["'](?:@\/lib\/supabase\/admin|\.{1,2}\/(?:[^"']*\/)?supabase\/admin)["']/;
const ADMIN_SYMBOL = /\b(getSupabaseAdmin|createAdminClient)\b/;
const SERVICE_ROLE_KEY = /SUPABASE_SERVICE_ROLE_KEY/;

describe("service-role client import guard", () => {
  const files = walk(SRC_DIR).filter((f) => !f.endsWith("admin.guard.test.ts"));

  it("admin.ts keeps the build-time server-only guard", () => {
    const adminSrc = readFileSync(join(SRC_DIR, "lib", "supabase", "admin.ts"), "utf8");
    expect(adminSrc).toMatch(/import\s+["']server-only["']/);
  });

  it("no \"use client\" module imports the service-role client or key", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (!isClientModule(src)) continue;
      if (ADMIN_IMPORT.test(src) || ADMIN_SYMBOL.test(src) || SERVICE_ROLE_KEY.test(src)) {
        offenders.push(relative(SRC_DIR, file));
      }
    }
    expect(
      offenders,
      `Client components must not touch the service-role client/key: ${offenders.join(", ")}`
    ).toEqual([]);
  });
});
