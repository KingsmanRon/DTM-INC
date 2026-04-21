#!/usr/bin/env node
// Convenience wrapper that prints the migrations in order so they can be
// piped to `psql` or the Supabase SQL editor. We deliberately do NOT execute
// arbitrary DDL from a Node script — migrations should be applied via the
// Supabase CLI (`supabase db push`) or `psql` with a human in the loop.

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = resolve(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

for (const f of files) {
  process.stdout.write(`-- ══ ${f} ══\n`);
  process.stdout.write(readFileSync(join(dir, f), "utf8"));
  process.stdout.write("\n\n");
}
