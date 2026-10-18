// Request handling for the ACCESS integration API, kept free of Next.js and
// Supabase so every branch is unit-tested (handlers.test.ts). The route files
// under src/app/api/v1/integrations/access only wire real dependencies in.
//
// Response codes are part of the contract ACCESS relies on to decide what
// happened (docs/integrations/access.md):
//   201/200  stored / already stored: the referral is in the inbox
//   401, 403, 409, 413, 422, 400, 503
//            refused before anything was stored
//   404      read-back only: nothing is stored for that execution id
//   500      unknown: ACCESS must read back before doing anything else
import type { AuditInput } from "@/lib/audit/log";
import type { AccessDataMode, AccessIntegrationConfig } from "./config";
import {
  DeliveryRequest,
  MAX_DELIVERY_BYTES,
  RECEIPT_SCHEMA_VERSION,
  deliveryHash,
  type DeliveryRequest as Delivery,
} from "./delivery";
import { HEADER_KEY_ID, HEADER_SIGNATURE, HEADER_TIMESTAMP, verifySignature } from "./signature";

export const STATUS_SCHEMA_VERSION = "access-referral-status.v1";

export type InboxStatus = "pending" | "accepted" | "declined";

export type ReceiveRow = {
  id: string;
  reference: string;
  status: InboxStatus;
  delivered_at: string;
  deduplicated: boolean;
  conflict: boolean;
};

export type ReadRow = {
  execution_id: string;
  reference: string;
  status: InboxStatus;
  delivered_at: string;
  resolved_at: string | null;
};

export type IntegrationRequest = {
  method: string;
  /** Path plus query exactly as received, e.g. /api/v1/integrations/access/referrals */
  pathWithQuery: string;
  headers: { get(name: string): string | null };
  body: string;
  ipAddress: string | null;
  userAgent: string | null;
};

export type IntegrationDeps = {
  config: AccessIntegrationConfig;
  receive(input: {
    executionId: string;
    correlationId: string;
    tenantId: string;
    dataMode: AccessDataMode;
    payloadSha256: string;
    referral: Delivery["referral"];
  }): Promise<ReceiveRow>;
  read(key: { executionId: string } | { reference: string }): Promise<ReadRow | null>;
  audit(input: AuditInput): Promise<void>;
  /** Signature failures are not audited (unbounded volume); they are counted here. */
  rejected(reason: string): void;
  now(): Date;
};

export type IntegrationResponse = { status: number; body: Record<string, unknown> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE = /^IN-\d{6,}$/;

function fail(status: number, code: string, extra: Record<string, unknown> = {}): IntegrationResponse {
  return { status, body: { ...extra, error: code } };
}

function pathOnly(pathWithQuery: string): string {
  return pathWithQuery.split("?")[0] ?? pathWithQuery;
}

/** Signature, key and clock checks shared by every route. */
function authenticate(req: IntegrationRequest, deps: IntegrationDeps): IntegrationResponse | null {
  if (!deps.config.enabled) return fail(503, "integration_disabled");
  const result = verifySignature({
    method: req.method,
    pathWithQuery: req.pathWithQuery,
    keyId: req.headers.get(HEADER_KEY_ID),
    timestamp: req.headers.get(HEADER_TIMESTAMP),
    signature: req.headers.get(HEADER_SIGNATURE),
    body: req.body,
    keys: deps.config.keys,
    now: deps.now(),
  });
  if (result.ok) return null;
  deps.rejected(result.reason);
  return fail(401, "unauthorised");
}

/** An authenticated sender refused for tenant, data mode or a conflict: audited. */
async function refuse(
  req: IntegrationRequest,
  deps: IntegrationDeps,
  reason: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await deps.audit({
    actorUserId: null,
    actorRole: null,
    action: "access_integration_denied",
    entityType: "access_integration",
    metadata: { reason, path: pathOnly(req.pathWithQuery), ...metadata },
    ipAddress: req.ipAddress,
    userAgent: req.userAgent,
  });
}

export async function handleDelivery(
  req: IntegrationRequest,
  deps: IntegrationDeps
): Promise<IntegrationResponse> {
  if (!deps.config.enabled) return fail(503, "integration_disabled");
  if (Buffer.byteLength(req.body, "utf8") > MAX_DELIVERY_BYTES) return fail(413, "payload_too_large");

  const denied = authenticate(req, deps);
  if (denied) return denied;
  const config = deps.config;

  let raw: unknown;
  try {
    raw = JSON.parse(req.body);
  } catch {
    return fail(400, "invalid_json");
  }
  const parsed = DeliveryRequest.safeParse(raw);
  if (!parsed.success) {
    // Paths and rule codes only: never echo submitted values back.
    return fail(422, "validation_error", {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })),
    });
  }
  const delivery = parsed.data;

  const idempotencyKey = req.headers.get("idempotency-key");
  if (idempotencyKey !== null && idempotencyKey.toLowerCase() !== delivery.execution_id.toLowerCase()) {
    return fail(400, "idempotency_key_mismatch");
  }

  if (delivery.access_tenant_id.toLowerCase() !== config.tenantId) {
    await refuse(req, deps, "tenant_not_allowed", { execution_id: delivery.execution_id });
    return fail(403, "tenant_not_allowed");
  }

  const dataMode: AccessDataMode = delivery.data_mode === "REAL" ? "real" : "synthetic";
  if (dataMode !== config.dataMode) {
    await refuse(req, deps, "data_mode_mismatch", {
      execution_id: delivery.execution_id,
      expected: config.dataMode,
      received: dataMode,
    });
    return fail(409, "data_mode_mismatch");
  }

  const row = await deps.receive({
    executionId: delivery.execution_id,
    correlationId: delivery.correlation_id,
    tenantId: delivery.access_tenant_id.toLowerCase(),
    dataMode,
    payloadSha256: deliveryHash(delivery),
    referral: delivery.referral,
  });

  if (row.conflict) {
    await refuse(req, deps, "idempotency_conflict", {
      execution_id: delivery.execution_id,
      reference: row.reference,
    });
    return fail(409, "idempotency_conflict", { reference: row.reference });
  }

  if (!row.deduplicated) {
    // No patient details in audit metadata: the inbox row holds them.
    await deps.audit({
      actorUserId: null,
      actorRole: null,
      action: "access_referral_received",
      entityType: "access_referral_inbox",
      entityId: row.id,
      metadata: {
        reference: row.reference,
        access_case_reference: delivery.referral.case_reference,
        execution_id: delivery.execution_id,
        correlation_id: delivery.correlation_id,
        data_mode: dataMode,
      },
      ipAddress: req.ipAddress,
      userAgent: req.userAgent,
    });
  }

  return {
    status: row.deduplicated ? 200 : 201,
    body: {
      schema_version: RECEIPT_SCHEMA_VERSION,
      execution_id: delivery.execution_id,
      reference: row.reference,
      status: row.status,
      delivered_at: row.delivered_at,
      deduplicated: row.deduplicated,
    },
  };
}

/** Read-back by execution id or inbox reference. Reference and status only. */
export async function handleReadBack(
  req: IntegrationRequest,
  key: { executionId: string } | { reference: string },
  deps: IntegrationDeps
): Promise<IntegrationResponse> {
  const denied = authenticate(req, deps);
  if (denied) return denied;

  if ("executionId" in key && !UUID.test(key.executionId)) return fail(400, "invalid_execution_id");
  if ("reference" in key && !REFERENCE.test(key.reference)) return fail(400, "invalid_reference");

  const row = await deps.read(
    "executionId" in key ? { executionId: key.executionId.toLowerCase() } : key
  );
  if (!row) return fail(404, "not_found");
  return {
    status: 200,
    body: {
      schema_version: STATUS_SCHEMA_VERSION,
      execution_id: row.execution_id,
      reference: row.reference,
      status: row.status,
      delivered_at: row.delivered_at,
      resolved_at: row.resolved_at,
    },
  };
}
