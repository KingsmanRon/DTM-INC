// Real dependencies for the ACCESS integration handlers. Server-only: this is
// the one place the integration uses the service-role client, and only to call
// the two SECURITY DEFINER functions granted to it (0063).
import "server-only";
import { writeAudit } from "@/lib/audit/log";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { accessIntegrationConfig } from "./config";
import type { IntegrationDeps, IntegrationRequest, ReadRow, ReceiveRow } from "./handlers";

/** A storage failure. Carries the Postgres error code only: messages can quote row values. */
export class IntegrationStoreError extends Error {
  constructor(public readonly code: string) {
    super(`access_integration_store_error:${code}`);
  }
}

export function integrationDeps(): IntegrationDeps {
  return {
    config: accessIntegrationConfig(),
    async receive(input) {
      const { data, error } = await getSupabaseAdmin()
        .rpc("receive_access_referral", {
          p_execution_id: input.executionId,
          p_correlation_id: input.correlationId,
          p_tenant_id: input.tenantId,
          p_data_mode: input.dataMode,
          p_payload_sha256: input.payloadSha256,
          p_referral: input.referral,
        })
        .maybeSingle();
      if (error || !data) throw new IntegrationStoreError(error?.code ?? "no_row");
      return data as ReceiveRow;
    },
    async read(key) {
      const { data, error } = await getSupabaseAdmin()
        .rpc(
          "read_access_referral",
          "executionId" in key
            ? { p_execution_id: key.executionId, p_reference: null }
            : { p_execution_id: null, p_reference: key.reference }
        )
        .maybeSingle();
      if (error) throw new IntegrationStoreError(error.code ?? "read_failed");
      return (data as ReadRow | null) ?? null;
    },
    audit: writeAudit,
    rejected(reason) {
      console.warn("[access-integration] request rejected", { reason });
    },
    now: () => new Date(),
  };
}

/** Logs a failure without anything that could carry patient details. */
export function logIntegrationFailure(what: string, err: unknown): void {
  const code = err instanceof IntegrationStoreError ? err.code : "unexpected";
  console.error(`[access-integration] ${what} failed`, { code });
}

export function toIntegrationRequest(
  req: { method: string; nextUrl: { pathname: string; search: string }; headers: Headers },
  body: string,
  ipAddress: string | null
): IntegrationRequest {
  return {
    method: req.method,
    pathWithQuery: `${req.nextUrl.pathname}${req.nextUrl.search}`,
    headers: req.headers,
    body,
    ipAddress,
    userAgent: req.headers.get("user-agent"),
  };
}
