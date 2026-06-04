import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// These tests pin the billing migration to the hard constraints from the
// feature preamble. They read the SQL directly so a regression in the migration
// (re-introducing a trigger, widening service_role, dropping the unique key, or
// leaking clinical content) fails CI rather than a code review.
const root = process.cwd();
const auditActions = readFileSync(
  resolve(root, "supabase/migrations/0035_billing_export_audit_actions.sql"),
  "utf8",
);
const items = readFileSync(
  resolve(root, "supabase/migrations/0036_billing_export_items.sql"),
  "utf8",
);

// Assert against the executable DDL, not the explanatory comments. The header
// comment legitimately mentions "no service_role", "clinical_notes RLS is
// untouched" etc. to document intent — those words must not fail the checks.
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, " ");
}
const ddl = stripSqlComments(items);

describe("0035 audit-action enum additions", () => {
  it("adds the three billing audit actions via ADD VALUE IF NOT EXISTS (no trigger)", () => {
    expect(auditActions).toMatch(/add value if not exists 'billing_export_generate'/);
    expect(auditActions).toMatch(/add value if not exists 'billing_export_item_update'/);
    expect(auditActions).toMatch(/add value if not exists 'billing_export_mark_returned'/);
  });
});

describe("0036 billing_export_items migration honours the hard constraints", () => {
  it("does NOT add any trigger (1.1 — audit/updated_at amplification incident)", () => {
    expect(ddl).not.toMatch(/create\s+trigger/i);
  });

  it("maintains updated_at explicitly in the write path instead", () => {
    expect(ddl).toMatch(/updated_at\s*=\s*now\(\)/i);
  });

  it("does NOT add or widen any service_role grant (1.5)", () => {
    expect(ddl).not.toMatch(/service_role/i);
  });

  it("never references clinical-note content (1.4 isolation)", () => {
    expect(ddl).not.toMatch(/encrypted_body|encrypted_ink|clinical_notes|nonce/i);
  });

  it("enforces a hard UNIQUE (patient_id, hospital, export_month) (4 — upsert key)", () => {
    expect(ddl).toMatch(/unique\s*\(patient_id,\s*hospital,\s*export_month\)/i);
    expect(ddl).toMatch(/on conflict \(patient_id, hospital, export_month\) do update/i);
  });

  it("constrains export_month to the first day of the month", () => {
    expect(ddl).toMatch(/export_month\s*=\s*date_trunc\('month',\s*export_month\)::date/i);
  });

  it("enables RLS and gates reads to doctor + staff only (3.4)", () => {
    expect(ddl).toMatch(/enable row level security/i);
    expect(ddl).toMatch(
      /billing_export_items_clinical_read[\s\S]*?\(select public\.current_app_role\(\)\) in \('doctor'::public\.role_name, 'staff'::public\.role_name\)/,
    );
  });

  it("grants only the authenticated role (RLS does the gating)", () => {
    expect(ddl).toMatch(
      /grant select, insert, update, delete on public\.billing_export_items to authenticated/i,
    );
  });
});
