import { describe, expect, it, vi } from "vitest";
import type { AuditInput } from "@/lib/audit/log";
import { accessIntegrationConfig } from "./config";
import { DeliveryRequest, deliveryHash, MAX_DELIVERY_BYTES } from "./delivery";
import {
  handleDelivery,
  handleReadBack,
  type IntegrationDeps,
  type IntegrationRequest,
  type ReadRow,
  type ReceiveRow,
} from "./handlers";
import { canonicalRequest, sha256Hex, signCanonical } from "./signature";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SECRET = "integration-test-secret-0123456789abcdef";
const EXECUTION = "0b4c1f2e-8d3a-4c5b-9e6f-7a8b9c0d1e2f";
const NOW = new Date("2026-10-17T08:00:00Z");
const PATH = "/api/v1/integrations/access/referrals";

const env = {
  ACCESS_INTEGRATION_KEYS: `2026-10:${SECRET}`,
  ACCESS_INTEGRATION_TENANT_ID: TENANT,
};

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "access-referral-delivery.v1",
    execution_id: EXECUTION,
    correlation_id: "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
    access_tenant_id: TENANT,
    data_mode: "SYNTHETIC",
    referral: {
      case_reference: "REF-1A2B3C4D",
      referral_id: "9d9d9d9d-9d9d-4d9d-9d9d-9d9d9d9d9d9d",
      received_at: "2026-10-17T07:55:00.000Z",
      patient: {
        given_name: "Synthetic",
        family_name: "Patient",
        date_of_birth: "1980-01-01",
        identifier: "8001015009087",
      },
      referrer: { name: "Dr Fixture" },
      reason: "Synthetic referral for review",
      requested_service: "GENERAL_SURGERY",
      referral_date: "2026-10-15",
      funding: { type: "MEDICAL_AID", scheme: "Synthetic Med" },
      documents_held: ["referral_letter"],
    },
    ...overrides,
  };
}

function signed(
  method: string,
  pathWithQuery: string,
  body: string,
  headers: Record<string, string> = {},
  secret = SECRET
): IntegrationRequest {
  const timestamp = String(Math.floor(NOW.getTime() / 1000));
  const signature = signCanonical(
    secret,
    canonicalRequest({ method, pathWithQuery, timestamp, bodySha256: sha256Hex(body) })
  );
  const all = new Headers({
    "x-access-key-id": "2026-10",
    "x-access-timestamp": timestamp,
    "x-access-signature": signature,
    ...headers,
  });
  return { method, pathWithQuery, headers: all, body, ipAddress: "203.0.113.7", userAgent: "access-worker" };
}

function deps(options: { receive?: Partial<ReceiveRow>; read?: ReadRow | null; config?: Record<string, string> } = {}) {
  const audits: AuditInput[] = [];
  const rejected: string[] = [];
  const receive = vi.fn(async () => ({
    id: "f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0",
    reference: "IN-000042",
    status: "pending" as const,
    delivered_at: "2026-10-17T08:00:01.000Z",
    deduplicated: false,
    conflict: false,
    ...options.receive,
  }));
  const read = vi.fn(async () => (options.read === undefined ? null : options.read));
  const d: IntegrationDeps = {
    config: accessIntegrationConfig(options.config ?? env),
    receive,
    read,
    audit: async (input) => {
      audits.push(input);
    },
    rejected: (reason) => rejected.push(reason),
    now: () => NOW,
  };
  return { d, audits, rejected, receive, read };
}

describe("ACCESS integration configuration", () => {
  it("is off until keys are set, and off again if anything is malformed", () => {
    expect(accessIntegrationConfig({})).toEqual({ enabled: false, reason: "not_configured" });
    expect(accessIntegrationConfig({ ...env, ACCESS_INTEGRATION_KEYS: "2026-10:short" })).toEqual({
      enabled: false,
      reason: "invalid_keys",
    });
    expect(accessIntegrationConfig({ ...env, ACCESS_INTEGRATION_KEYS: SECRET })).toEqual({
      enabled: false,
      reason: "invalid_keys",
    });
    expect(
      accessIntegrationConfig({ ...env, ACCESS_INTEGRATION_KEYS: `a:${SECRET},a:${SECRET}` })
    ).toEqual({ enabled: false, reason: "invalid_keys" });
    expect(accessIntegrationConfig({ ...env, ACCESS_INTEGRATION_TENANT_ID: "tenant-1" })).toEqual({
      enabled: false,
      reason: "invalid_tenant",
    });
    expect(accessIntegrationConfig({ ...env, ACCESS_INTEGRATION_DATA_MODE: "live" })).toEqual({
      enabled: false,
      reason: "invalid_data_mode",
    });
  });

  it("defaults to synthetic data and accepts two keys during a rotation", () => {
    const config = accessIntegrationConfig({
      ...env,
      ACCESS_INTEGRATION_KEYS: `2026-11:${SECRET}x,2026-10:${SECRET}`,
      ACCESS_INTEGRATION_TENANT_ID: TENANT.toUpperCase(),
    });
    expect(config).toMatchObject({ enabled: true, tenantId: TENANT, dataMode: "synthetic" });
    expect(config.enabled && [...config.keys.keys()]).toEqual(["2026-11", "2026-10"]);
  });
});

describe("delivery schema", () => {
  it("accepts the contract example and rejects unknown fields", () => {
    expect(DeliveryRequest.safeParse(delivery()).success).toBe(true);
    expect(DeliveryRequest.safeParse(delivery({ extra: true })).success).toBe(false);
    const body = delivery();
    (body.referral.patient as Record<string, unknown>).address = "1 Test Street";
    expect(DeliveryRequest.safeParse(body).success).toBe(false);
  });

  it("rejects impossible dates and control characters", () => {
    const badDate = delivery();
    badDate.referral.patient.date_of_birth = "2026-02-30";
    expect(DeliveryRequest.safeParse(badDate).success).toBe(false);
    const badName = delivery();
    badName.referral.patient.family_name = "Patient\u0000";
    expect(DeliveryRequest.safeParse(badName).success).toBe(false);
  });

  it("hashes the same delivery the same way whatever the key order", () => {
    const a = DeliveryRequest.parse(delivery());
    const reordered = JSON.parse(JSON.stringify(delivery(), Object.keys(delivery()).reverse()));
    const b = DeliveryRequest.parse({ ...reordered, referral: delivery().referral });
    expect(deliveryHash(a)).toBe(deliveryHash(b));
    const changed = DeliveryRequest.parse(delivery({ data_mode: "REAL" }));
    expect(deliveryHash(changed)).not.toBe(deliveryHash(a));
  });
});

describe("delivering a referral", () => {
  it("stores a new referral, answers 201 and audits it without patient details", async () => {
    const { d, audits, receive } = deps();
    const body = JSON.stringify(delivery());
    const result = await handleDelivery(signed("POST", PATH, body, { "idempotency-key": EXECUTION }), d);
    expect(result).toEqual({
      status: 201,
      body: {
        schema_version: "access-referral-receipt.v1",
        execution_id: EXECUTION,
        reference: "IN-000042",
        status: "pending",
        delivered_at: "2026-10-17T08:00:01.000Z",
        deduplicated: false,
      },
    });
    expect(receive).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: EXECUTION, tenantId: TENANT, dataMode: "synthetic" })
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "access_referral_received",
      actorUserId: null,
      entityId: "f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0",
    });
    const auditText = JSON.stringify(audits[0]);
    for (const detail of ["Synthetic", "Patient", "8001015009087", "1980-01-01", "Dr Fixture"]) {
      expect(auditText).not.toContain(detail);
    }
  });

  it("answers a replay with 200 and does not audit it again", async () => {
    const { d, audits } = deps({ receive: { deduplicated: true } });
    const result = await handleDelivery(signed("POST", PATH, JSON.stringify(delivery())), d);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ deduplicated: true, reference: "IN-000042" });
    expect(audits).toHaveLength(0);
  });

  it("refuses a changed delivery under the same execution id and audits the conflict", async () => {
    const { d, audits } = deps({ receive: { deduplicated: true, conflict: true } });
    const result = await handleDelivery(signed("POST", PATH, JSON.stringify(delivery())), d);
    expect(result).toEqual({ status: 409, body: { error: "idempotency_conflict", reference: "IN-000042" } });
    expect(audits[0]).toMatchObject({ action: "access_integration_denied", metadata: { reason: "idempotency_conflict" } });
  });

  it("is off (503) until configured, and stores nothing", async () => {
    const { d, receive } = deps({ config: {} });
    const result = await handleDelivery(signed("POST", PATH, JSON.stringify(delivery())), d);
    expect(result).toEqual({ status: 503, body: { error: "integration_disabled" } });
    expect(receive).not.toHaveBeenCalled();
  });

  it("refuses an unsigned or wrongly signed request without auditing it", async () => {
    const { d, audits, rejected, receive } = deps();
    const body = JSON.stringify(delivery());
    const forged = signed("POST", PATH, body, {}, "someone-elses-secret-0123456789abcdef");
    expect(await handleDelivery(forged, d)).toEqual({ status: 401, body: { error: "unauthorised" } });
    const unsigned = { ...forged, headers: new Headers() };
    expect((await handleDelivery(unsigned, d)).status).toBe(401);
    expect(rejected).toEqual(["bad_signature", "missing_headers"]);
    expect(receive).not.toHaveBeenCalled();
    expect(audits).toHaveLength(0);
  });

  it("refuses an oversized body before checking anything else", async () => {
    const { d } = deps();
    const big = "x".repeat(MAX_DELIVERY_BYTES + 1);
    expect(await handleDelivery(signed("POST", PATH, big), d)).toEqual({
      status: 413,
      body: { error: "payload_too_large" },
    });
  });

  it("refuses malformed JSON and invalid deliveries without echoing values", async () => {
    const { d, receive } = deps();
    expect((await handleDelivery(signed("POST", PATH, "{not json"), d)).status).toBe(400);
    const invalid = delivery();
    invalid.referral.patient.date_of_birth = "01/01/1980";
    const result = await handleDelivery(signed("POST", PATH, JSON.stringify(invalid)), d);
    expect(result.status).toBe(422);
    expect(JSON.stringify(result.body)).not.toContain("01/01/1980");
    const issues = result.body.issues as { path: string }[];
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.path === "referral.patient.date_of_birth")).toBe(true);
    expect(receive).not.toHaveBeenCalled();
  });

  it("refuses an Idempotency-Key that names another execution", async () => {
    const { d } = deps();
    const result = await handleDelivery(
      signed("POST", PATH, JSON.stringify(delivery()), { "idempotency-key": "00000000-0000-4000-8000-000000000000" }),
      d
    );
    expect(result).toEqual({ status: 400, body: { error: "idempotency_key_mismatch" } });
  });

  it("refuses another ACCESS organisation and audits the attempt", async () => {
    const { d, audits, receive } = deps();
    const result = await handleDelivery(
      signed("POST", PATH, JSON.stringify(delivery({ access_tenant_id: "22222222-2222-4222-8222-222222222222" }))),
      d
    );
    expect(result).toEqual({ status: 403, body: { error: "tenant_not_allowed" } });
    expect(audits[0]).toMatchObject({ action: "access_integration_denied", metadata: { reason: "tenant_not_allowed" } });
    expect(receive).not.toHaveBeenCalled();
  });

  it("keeps synthetic and real data apart in both directions", async () => {
    const synthetic = deps();
    const real = await handleDelivery(signed("POST", PATH, JSON.stringify(delivery({ data_mode: "REAL" }))), synthetic.d);
    expect(real).toEqual({ status: 409, body: { error: "data_mode_mismatch" } });
    expect(synthetic.receive).not.toHaveBeenCalled();

    const live = deps({ config: { ...env, ACCESS_INTEGRATION_DATA_MODE: "real" } });
    const test = await handleDelivery(signed("POST", PATH, JSON.stringify(delivery())), live.d);
    expect(test).toEqual({ status: 409, body: { error: "data_mode_mismatch" } });
    expect(live.audits[0]).toMatchObject({ metadata: { expected: "real", received: "synthetic" } });
  });

  it("lets a storage failure surface as an error, so the route answers 500", async () => {
    const { d } = deps();
    d.receive = async () => {
      throw new Error("connection lost");
    };
    await expect(handleDelivery(signed("POST", PATH, JSON.stringify(delivery())), d)).rejects.toThrow();
  });
});

describe("reading a delivery back", () => {
  const found: ReadRow = {
    execution_id: EXECUTION,
    reference: "IN-000042",
    status: "accepted",
    delivered_at: "2026-10-17T08:00:01.000Z",
    resolved_at: "2026-10-17T09:00:00.000Z",
  };

  it("returns the reference and status for a stored execution id", async () => {
    const { d, read } = deps({ read: found });
    const result = await handleReadBack(signed("GET", `${PATH}/${EXECUTION}`, ""), { executionId: EXECUTION }, d);
    expect(result).toEqual({ status: 200, body: { schema_version: "access-referral-status.v1", ...found } });
    expect(read).toHaveBeenCalledWith({ executionId: EXECUTION });
  });

  it("answers 404 only when nothing is stored", async () => {
    const { d } = deps({ read: null });
    const result = await handleReadBack(signed("GET", `${PATH}/${EXECUTION}`, ""), { executionId: EXECUTION }, d);
    expect(result).toEqual({ status: 404, body: { error: "not_found" } });
  });

  it("looks up by inbox reference and validates both keys", async () => {
    const { d } = deps({ read: found });
    const byRef = await handleReadBack(signed("GET", `${PATH}?reference=IN-000042`, ""), { reference: "IN-000042" }, d);
    expect(byRef.status).toBe(200);
    const badId = await handleReadBack(signed("GET", `${PATH}/not-a-uuid`, ""), { executionId: "not-a-uuid" }, d);
    expect(badId).toEqual({ status: 400, body: { error: "invalid_execution_id" } });
    const badRef = await handleReadBack(signed("GET", `${PATH}?reference=X`, ""), { reference: "X" }, d);
    expect(badRef).toEqual({ status: 400, body: { error: "invalid_reference" } });
  });

  it("signs the read-back path: a request signed for another execution is refused", async () => {
    const { d } = deps({ read: found });
    const other = signed("GET", `${PATH}/00000000-0000-4000-8000-000000000000`, "");
    const replayed = { ...other, pathWithQuery: `${PATH}/${EXECUTION}` };
    expect((await handleReadBack(replayed, { executionId: EXECUTION }, d)).status).toBe(401);
  });
});
