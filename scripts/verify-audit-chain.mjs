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
// Composite cursor (created_at, id). A scalar created_at cursor with `gt`
// silently skips any subsequent row that shares the cursor's timestamp —
// common at millisecond resolution and fatal for chain verification.
let cursorCreatedAt = null;
let cursorId = null;
let total = 0;

while (true) {
  let q = supabase
    .from("audit_logs").select("*")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(500);
  if (cursorCreatedAt && cursorId) {
    q = q.or(
      `created_at.gt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.gt.${cursorId})`
    );
  }
  const { data, error } = await q;
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
    cursorCreatedAt = row.created_at;
    cursorId = row.id;
    total++;
  }
  if (data.length < 500) break;
}

console.log(`OK · verified ${total} audit rows`);
process.exit(0);
