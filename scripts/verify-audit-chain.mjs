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

// This script is the deep manual tool: it ALWAYS walks the full chain from
// genesis (the daily cron does the incremental, checkpointed walk). Walk order
// is chain_position (migration 0048) — the chain's physical insertion order —
// never created_at, which clock skew between writers can reorder.
let prev = null;
let cursorPosition = 0;
let total = 0;

while (true) {
  const { data, error } = await supabase
    .from("audit_logs").select("*")
    .gt("chain_position", cursorPosition)
    .order("chain_position", { ascending: true })
    .limit(500);
  if (error) { console.error("db error:", error.message); process.exit(3); }
  if (!data || data.length === 0) break;
  for (const row of data) {
    // chain_position, occurred_at and chain_anchor_id ride OUTSIDE the entry
    // hash by design — hash exactly the writer's field set, nothing more.
    const hashed = {
      actor_user_id: row.actor_user_id,
      actor_role: row.actor_role,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      patient_id: row.patient_id,
      metadata_json: row.metadata_json,
      ip_address: row.ip_address,
      user_agent: row.user_agent,
      // Postgres returns timestamptz as "…+00:00"; the writer hashed the
      // ISO "…Z" form. Canonicalise to the same instant string.
      created_at: new Date(row.created_at).toISOString(),
      prev_hash: row.prev_hash,
    };
    const expected = compute(prev, hashed);
    if (expected !== row.entry_hash) {
      console.error(`CHAIN BROKEN at row ${row.id} (position ${row.chain_position}, ${row.created_at}) action=${row.action}`);
      process.exit(1);
    }
    prev = row.entry_hash;
    cursorPosition = row.chain_position;
    total++;
  }
  if (data.length < 500) break;
}

console.log(`OK · verified ${total} audit rows (full walk to position ${cursorPosition})`);
process.exit(0);
