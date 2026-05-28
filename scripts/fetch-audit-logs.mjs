#!/usr/bin/env node
// Fetches recent audit_logs rows from Supabase with optional filters.
//
// Usage examples:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/fetch-audit-logs.mjs
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/fetch-audit-logs.mjs --limit=200 --action=patient_create
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/fetch-audit-logs.mjs --patient-id=<uuid> --json

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and/or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

function parseArgs(argv) {
  const args = {
    limit: 100,
    offset: 0,
    action: null,
    patientId: null,
    json: false,
  };

  for (const arg of argv) {
    if (arg === "--json") args.json = true;
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.split("=")[1]);
    else if (arg.startsWith("--offset=")) args.offset = Number(arg.split("=")[1]);
    else if (arg.startsWith("--action=")) args.action = arg.split("=")[1] || null;
    else if (arg.startsWith("--patient-id=")) args.patientId = arg.split("=")[1] || null;
  }

  if (!Number.isFinite(args.limit) || args.limit <= 0) args.limit = 100;
  if (!Number.isFinite(args.offset) || args.offset < 0) args.offset = 0;
  if (args.limit > 500) args.limit = 500;

  return args;
}

const args = parseArgs(process.argv.slice(2));
const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

let query = supabase
  .from("audit_logs")
  .select("id, actor_user_id, actor_role, action, entity_type, entity_id, patient_id, ip_address, created_at, metadata_json")
  .order("created_at", { ascending: false })
  .range(args.offset, args.offset + args.limit - 1);

if (args.action) query = query.eq("action", args.action);
if (args.patientId) query = query.eq("patient_id", args.patientId);

const { data, error } = await query;
if (error) {
  console.error("Failed to query audit_logs:", error.message);
  process.exit(1);
}

if (args.json) {
  console.log(JSON.stringify(data ?? [], null, 2));
  process.exit(0);
}

if (!data || data.length === 0) {
  console.log("No audit logs found for supplied filters.");
  process.exit(0);
}

console.table(
  data.map((row) => ({
    id: row.id,
    created_at: row.created_at,
    action: row.action,
    actor_role: row.actor_role,
    patient_id: row.patient_id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
  }))
);

console.log(`\nFetched ${data.length} row(s).`);
