#!/usr/bin/env node
// Walks the audit_logs hash chain end-to-end and exits non-zero on break.
// Intended to run as a daily cron (§10.5, AC-7).
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/verify-audit-chain.mjs

import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

function canonicalJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(v).sort()
    .map((k) => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
}

function compute(prev, row) {
  const h = createHash("sha256");
  h.update(prev ?? "");
  h.update("|");
  h.update(canonicalJson(row));
  return h.digest("hex");
}

let prev = null;
let cursor = "1970-01-01T00:00:00.000Z";
let total = 0;

while (true) {
  const { data, error } = await supabase
    .from("audit_logs").select("*")
    .gt("created_at", cursor).order("created_at", { ascending: true }).limit(500);
  if (error) { console.error("db error:", error.message); process.exit(3); }
  if (!data || data.length === 0) break;
  for (const row of data) {
    const { id, entry_hash, chain_anchor_id, ...rest } = row;
    void id; void chain_anchor_id;
    const expected = compute(prev, rest);
    if (expected !== entry_hash) {
      console.error(`CHAIN BROKEN at row ${row.id} (${row.created_at}) action=${row.action}`);
      process.exit(1);
    }
    prev = entry_hash;
    cursor = row.created_at;
    total++;
  }
}

console.log(`OK · verified ${total} audit rows`);
process.exit(0);
