import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ClientConfig, parseClientConfig, bootstrapSql, initialUsersSql, brandingEnv, type ClientConfiguration } from "./client-config";

// Synthetic data only; never a proposed client's identity or legal wording.
export function testClient(): ClientConfiguration {
  return ClientConfig.parse({
    schema_version: 1, project_ref: "zzzzzzzzzzzzzzzzzzzz",
    practice: {
      practice_name: "Synthetic Test Practice", practice_tagline: "Test only", practice_number: "TEST",
      doctor_name: "Synthetic Doctor", doctor_qualifications: "Test only", practice_address: "Test only",
      practice_phone: "000", information_officer_name: "Synthetic Officer", information_officer_email: "io@synthetic.test",
      privacy_notice_body: "Test only, not legal wording", active_consent_version: "test-v1", active_consent_body: "Test only",
      consent_cards: [{ badge: "A", title: "Test only", body: "Test only" }], logo_path: "letterhead.png",
      file_number_prefix: "SY", file_number_format: "{PREFIX}-{YYYY}-{SEQ:06}",
    },
    facilities: [{ name: "Synthetic Facility", file_prefix: "SY", active: true, display_order: 10 }],
    initial_sequences: [{ prefix: "SY", year: 2026, next_value: 700 }],
    initial_users: [{ full_name: "Test Admin", email: "admin@synthetic.test", role: "admin" }, { full_name: "Test Doctor", email: "doctor@synthetic.test", role: "doctor" }],
    branding: { app_name: "Synthetic Practice", app_title: "Synthetic Records", app_description: "Synthetic test", app_url: "https://synthetic.test" },
  });
}

describe("offline client bootstrap", () => {
  it("refuses executable defaults, secrets and missing owner information", () => {
    expect(() => parseClientConfig(JSON.parse(readFileSync("config/client.example.json", "utf8")))).toThrow(/placeholder/);
    expect(() => parseClientConfig({ ...testClient(), service_role_key: "must-not-be-here" })).toThrow();
    expect(() => parseClientConfig({ ...testClient(), initial_users: [] })).toThrow();
  });
  it("rejects duplicate facilities, emails, sequences and unknown prefixes", () => {
    const c = testClient();
    expect(() => parseClientConfig({ ...c, facilities: [...c.facilities, c.facilities[0]] })).toThrow();
    expect(() => parseClientConfig({ ...c, initial_users: [...c.initial_users, c.initial_users[0]] })).toThrow();
    expect(() => parseClientConfig({ ...c, initial_sequences: [{ prefix: "BAD", year: 2026, next_value: 1 }] })).toThrow();
  });
  it("rejects numbering formats that collide across facilities or years", () => {
    const c = testClient();
    expect(() => parseClientConfig({ ...c, practice: { ...c.practice, file_number_format: "{SEQ:06}" } })).toThrow();
    expect(() => parseClientConfig({ ...c, practice: { ...c.practice, file_number_format: "{PREFIX}/{YYYY}/{SEQ:06}" } })).not.toThrow();
  });
  it("never interpolates free text into executable SQL", () => {
    const c = testClient();
    c.practice.active_consent_body = "O'Brien $bootstrap$; DROP TABLE patients; --";
    const sql = bootstrapSql(c);
    expect(sql).not.toContain(c.practice.active_consent_body);
    expect(sql).toContain(Buffer.from(JSON.stringify(c)).toString("hex"));
    expect(sql).toContain("Bootstrap refuses nonempty table");
    expect(sql).toContain("configuration_hash");
    expect(initialUsersSql(c)).toContain("where lower(email) = u.email");
  });
  it("generates a client profile with no credentials or DTM fallback", () => {
    const env = brandingEnv(testClient());
    expect(env).toContain('NEXT_PUBLIC_DEPLOYMENT_PROFILE="client"');
    expect(env).toContain('ALLOW_DEV_KEK_FALLBACK="false"');
    expect(env).not.toMatch(/DTM|Mtshali|SERVICE_ROLE_KEY|CRON_SECRET/);
  });
});
