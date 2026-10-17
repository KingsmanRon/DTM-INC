import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Pins the ACCESS inbox migrations to their security shape. The pgTAP suite
// (supabase/tests/access_referral_inbox.test.sql) proves the behaviour against
// a database; these checks fail fast in the release gate if the SQL drifts.
const root = process.cwd();
const read = (file: string) => readFileSync(resolve(root, "supabase/migrations", file), "utf8");
const strip = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, " ");

const actions = read("0062_access_integration_audit_actions.sql");
const inbox = strip(read("0063_access_referral_inbox.sql"));
const auditLog = readFileSync(resolve(root, "src/lib/audit/log.ts"), "utf8");

const NEW_ACTIONS = [
  "access_referral_received",
  "access_referral_view",
  "access_referral_accepted",
  "access_referral_declined",
  "access_integration_denied",
];

describe("0062 audit actions", () => {
  it("adds each action alone, and the app knows every one", () => {
    for (const action of NEW_ACTIONS) {
      expect(actions).toContain(`add value if not exists '${action}'`);
      expect(auditLog).toContain(`"${action}"`);
    }
    expect(strip(actions)).not.toMatch(/create|insert|update|grant/i);
  });
});

describe("0063 access_referral_inbox", () => {
  it("enables RLS with a doctor/staff read policy and no write policy", () => {
    expect(inbox).toMatch(/alter table public\.access_referral_inbox enable row level security/);
    expect(inbox).toMatch(/for select to authenticated/);
    expect(inbox).not.toMatch(/for (insert|update|delete|all) to/);
  });

  it("gives API roles nothing on the table except signed-in read", () => {
    expect(inbox).toMatch(/revoke all on public\.access_referral_inbox from public, anon, authenticated, service_role/);
    expect(inbox).toMatch(/grant select on public\.access_referral_inbox to authenticated;/);
    expect(inbox).not.toMatch(/grant (insert|update|delete|all)[^;]*access_referral_inbox/);
  });

  it("keeps the integration functions to the service role and reception functions to signed-in users", () => {
    expect(inbox).toMatch(/revoke all on function public\.receive_access_referral\([^)]*\)\s+from public, anon, authenticated;/);
    expect(inbox).toMatch(/grant execute on function public\.receive_access_referral\([^)]*\)\s+to service_role;/);
    expect(inbox).toMatch(/revoke all on function public\.read_access_referral\(uuid, text\) from public, anon, authenticated;/);
    expect(inbox).toMatch(/revoke all on function public\.accept_access_referral\([^)]*\)\s+from public, anon, service_role;/);
    expect(inbox).toMatch(/revoke all on function public\.decline_access_referral\(uuid, text\) from public, anon, service_role;/);
  });

  it("checks the caller's role inside every reception function", () => {
    const accept = inbox.slice(inbox.indexOf("function public.accept_access_referral"));
    const decline = inbox.slice(inbox.indexOf("function public.decline_access_referral"));
    for (const body of [accept, decline]) {
      expect(body).toMatch(/v_actor\s+uuid := auth\.uid\(\)/);
      expect(body).toMatch(/current_app_role\(\)/);
      expect(body).toMatch(/not in \('doctor', 'staff'\)/);
    }
  });

  it("never creates or edits a patient", () => {
    expect(inbox).not.toMatch(/insert into public\.patients\b/);
    expect(inbox).not.toMatch(/update public\.patients\b/);
  });
});
