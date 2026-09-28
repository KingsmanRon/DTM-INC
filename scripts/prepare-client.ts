import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { parseClientConfig, bootstrapSql, initialUsersSql, brandingEnv } from "./lib/client-config";

// Offline generator only: deliberately no database/client/network dependencies.
const { values } = parseArgs({ options: { config: { type: "string" }, out: { type: "string" } } });
if (!values.config || !values.out) throw new Error("Usage: npm run client:prepare -- --config client-config/practice.json --out client-output/practice");
const c = parseClientConfig(JSON.parse(readFileSync(values.config, "utf8")));
const out = resolve(values.out);
if (existsSync(out)) throw new Error("Output directory already exists; choose a new directory to preserve the reviewed bundle");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "bootstrap.sql"), bootstrapSql(c));
writeFileSync(join(out, "initial-users.sql"), initialUsersSql(c));
writeFileSync(join(out, "branding.env"), brandingEnv(c));
writeFileSync(join(out, "README.txt"), "Review these files before use. No database was contacted. Run bootstrap.sql BEFORE creating Auth users; then bind the Auth users with initial-users.sql. Supply Supabase keys and CRON_SECRET separately in the new Vercel project. See docs/client-onboarding-runbook.md.\n");
console.log("Generated bootstrap.sql, initial-users.sql and branding.env. No secrets or connections used.");
